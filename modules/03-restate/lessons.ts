/**
 * Module 3 hands-on lessons. Each one starts a fresh Restate server and the
 * shop service, does something real, and shows you the same CLI output a
 * support engineer would look at.
 *
 *   npm run m3 -- 3.3     run one lesson
 *   npm run m3            run them all in order
 *
 * Nothing else should be running on ports 8080, 9070 or 9080.
 */
import fs from "node:fs";
import path from "node:path";
import { clearFaults, clearLedger, countFor, readLedger, RUNTIME_DIR, setFault } from "../../shared/fake-world.js";
import {
  call,
  cli,
  invocationStatus,
  register,
  Service,
  showCall,
  showSql,
  shutdown,
  sql,
  startServer,
  waitFor,
  waitForStatus,
} from "../../shared/restate-harness.js";
import { bad, bold, explainError, good, heading, pause, predict, red, reveal, say, sleep } from "../../shared/term.js";
import { PROVIDER_INBOX } from "./shop/async-payments.js";

const SHOP = "modules/03-restate/shop/app.ts";
const ORDER = (orderId: string, extra: Record<string, unknown> = {}) => ({
  orderId,
  sku: "SKU-42",
  amountCents: 4999,
  address: "123 Main St, Bozeman MT",
  ...extra,
});

function ledgerLine(orderId: string) {
  const entries = readLedger().filter((e) => e.orderId === orderId);
  console.log("  Ledger for " + bold(orderId) + ":");
  if (!entries.length) console.log("    (nothing happened)");
  for (const e of entries) console.log(`    ${e.system.padEnd(9)} ${e.action.padEnd(20)} ${e.detail}`);
}

/** Start the server and the shop. Returns the shop so lessons can crash it. */
async function boot(env: Record<string, string> = {}) {
  say("Starting a fresh Restate server and the shop service…");
  await startServer();
  const shop = new Service(SHOP, env);
  await shop.start();
  register();
  return shop;
}

const lessons: Record<string, { title: string; run: () => Promise<void> }> = {
  // -------------------------------------------------------------------------
  "3.2": {
    title: "Your first service",
    async run() {
      await boot();
      say("The shop is running on port 9080 and registered with Restate.");
      say("Clients never call the service directly. They call Restate on port 8080, and");
      say("Restate calls the service. The URL is <service>/<handler>:");
      await showCall("Greeter/greet", "Dana");
      say("That request became an invocation, with an id and a journal. List recent ones:");
      cli(["invocations", "list", "--all"]);
      say("And look at what Restate knows about the services it can call:");
      cli(["services", "list"]);
      reveal("Every request through Restate is recorded. That's what makes everything in");
      reveal("the rest of this module possible, and it's your best friend in support.");
    },
  },

  // -------------------------------------------------------------------------
  "3.3": {
    title: "Durable steps with ctx.run",
    async run() {
      const shop = await boot({ PICKUP_WAIT_SECONDS: "8" });
      say("Orders/checkout reserves stock, charges the card, waits 8s for pickup, then ships.");
      say("We send the order without waiting for it to finish (note /send in the URL):");
      const { body } = await showCall<{ invocationId: string }>("Orders/checkout", ORDER("order-33"), { send: true });
      const id = body.invocationId;
      await waitFor("the charge", () => countFor("order-33", "bank", "charge") === 1);
      await sleep(500);

      say("The card is charged and the order is waiting for pickup. Now we kill the service.");
      await shop.kill();
      bad("Shop service killed.");
      await predict("The service is dead mid-order. What will Restate do when the 8-second wait ends?", [
        "Mark the order failed",
        "Keep retrying until the service is back, then carry on after the wait",
        "Start the order over from the beginning",
      ]);
      await sleep(9000);
      cli(["invocations", "describe", id]);
      reveal(`b. Status ${bold("backing-off")}: Restate can't reach the service ("connection refused")`);
      reveal("and is retrying with growing delays. The journal still holds every finished step.");
      await pause();

      say("Bring the service back and nudge the order to retry right away:");
      await shop.start();
      cli(["invocations", "resume", id, "--yes"]);
      await waitForStatus(id, "completed");
      cli(["invocations", "journal", id]);
      ledgerLine("order-33");
      reveal("One charge, one shipment. After the restart, entries 1–9 were replayed from the");
      reveal("journal; only entries 10 onward ran for real. Same idea as your mini engine, but");
      reveal("the journal lives in the Restate server, so the service can die and move freely.");
      reveal("Notice the journal records more than ctx.run steps: calls to other services,");
      reveal("one-way sends, the timer. Anything that touches the outside world goes through ctx.");
    },
  },

  // -------------------------------------------------------------------------
  "3.4": {
    title: "Calling, sending and idempotency",
    async run() {
      await boot({ PICKUP_WAIT_SECONDS: "1" });
      say("Checkout talks to other services three ways. Look at modules/03-restate/shop/orders.ts:");
      say("  • Payments.charge with serviceClient: call and WAIT for the answer");
      say("  • Emails.send with serviceSendClient: send and DON'T wait");
      say("  • Emails.send with a delay: Restate holds the message, delivers it later");
      await showCall("Orders/checkout", ORDER("order-34"), { idempotencyKey: "order-34" });
      await sleep(3500);
      ledgerLine("order-34");
      say("Each of those calls is its own invocation, linked to the order that made it:");
      showSql("SELECT target, status, invoked_by_target FROM sys_invocation WHERE target NOT LIKE 'Greeter%' ORDER BY created_at");
      await pause();

      say(bold("Idempotency at the front door."));
      say("A customer double-clicks \"Place order\". The app sends the same request again,");
      say("with the same idempotency-key header:");
      await predict("How many times is order-34 charged now?", ["1", "2"]);
      await showCall("Orders/checkout", ORDER("order-34"), { idempotencyKey: "order-34" });
      ledgerLine("order-34");
      reveal("Once. Restate saw the key, didn't start a new checkout, and returned the stored");
      reveal("result of the first one. With /send you'd see status \"PreviouslyAccepted\".");
      reveal("Same idea as lesson 2.5, applied to requests coming INTO Restate.");
    },
  },

  // -------------------------------------------------------------------------
  "3.5": {
    title: "Errors, retries and TerminalError",
    async run() {
      await boot({ PICKUP_WAIT_SECONDS: "1" });

      say(bold("A) A transient failure: the bank returns 503 four times, then recovers."));
      setFault("bank.charge", { mode: "error", times: 4 });
      const a = await showCall<{ invocationId: string }>("Orders/checkout", ORDER("order-35a"), { send: true });
      await sleep(1500);
      say("Catch the payment while it's still failing. List what's in flight, then describe it:");
      cli(["invocations", "list", "--service", "Payments"]);
      const [pay] = sql<{ id: string }>("SELECT id FROM sys_invocation WHERE target = 'Payments/charge'");
      cli(["invocations", "describe", pay.id]);
      reveal(`${bold("backing-off")} with a retry count and the bank's 503 as the last error. Restate`);
      reveal("waits a little longer before each attempt. Nobody wrote retry code for this.");
      await waitForStatus(a.body.invocationId, "completed", 30_000);
      ledgerLine("order-35a");
      say("The bank recovered, the next retry succeeded, and the order finished: one charge.");
      await pause();

      say(bold("B) A permanent failure: the card is declined."));
      say("Payments turns the decline into a TerminalError (see shop/payments.ts).");
      setFault("bank.charge", { mode: "decline", times: 1 });
      await predict("What does the customer's checkout request get back?", [
        "It hangs while Restate retries",
        "An error right away: \"Card declined\"",
        "Success, the decline is ignored",
      ]);
      await showCall("Orders/checkout", ORDER("order-35b"));
      ledgerLine("order-35b");
      reveal("b. A TerminalError isn't retried. It travels back up through Orders to the");
      reveal("caller. Notice the stock is still reserved: lesson 3.10 fixes that with a saga.");
      await pause();

      say(bold("C) A bug that never goes away, with a retry limit."));
      say("InventorySync/sync calls a supplier API that's broken. Its retry policy allows");
      say("4 attempts, then pauses (see shop/inventory-sync.ts).");
      const { body } = await showCall<{ invocationId: string }>("InventorySync/sync", "SKU-42", { send: true });
      await waitForStatus(body.invocationId, "paused", 20_000);
      cli(["invocations", "describe", body.invocationId]);
      reveal(`Status ${bold("paused")}. Restate stopped retrying, but kept everything. Nothing is`);
      reveal("lost, nothing hammers the supplier, and someone can fix the cause and resume.");
      await pause();
      say("The supplier is fixed. Resume the invocation:");
      fs.writeFileSync(path.join(RUNTIME_DIR, "supplier-fixed"), "");
      cli(["invocations", "resume", body.invocationId, "--yes"]);
      await waitForStatus(body.invocationId, "completed");
      good(`InventorySync completed: ${invocationStatus(body.invocationId)}`);
    },
  },

  // -------------------------------------------------------------------------
  "3.6": {
    title: "Timers and suspension",
    async run() {
      const shop = await boot();
      say("Reminders/remind waits, then emails. Ask for a reminder in 12 seconds:");
      const { body } = await showCall<{ invocationId: string }>("Reminders/remind", { orderId: "cart-36", inSeconds: 12 }, { send: true });
      const id = body.invocationId;
      await waitForStatus(id, "suspended", 10_000);
      cli(["invocations", "describe", id]);
      reveal(`Status ${bold("suspended")}: the invocation is waiting on a timer, and the service is`);
      reveal("not doing anything for it. Restate holds the timer.");
      await pause();

      await predict("We kill the service now, while the reminder is suspended. What changes?", [
        "Restate reports errors right away",
        "Nothing: a suspended invocation doesn't need the service until the timer fires",
        "The reminder is cancelled",
      ]);
      await shop.kill();
      bad("Shop service killed.");
      await sleep(1500);
      say(`Status now: ${bold(invocationStatus(id))}`);
      reveal("b. Still suspended, no errors. Compare lesson 3.3, where the service died while");
      reveal("the invocation was actively running and Restate had to retry.");
      say("Restart the service before the timer fires…");
      await shop.start();
      await waitForStatus(id, "completed", 20_000);
      ledgerLine("cart-36");
      good("The reminder went out on time.");
    },
  },

  // -------------------------------------------------------------------------
  "3.7": {
    title: "Virtual objects",
    async run() {
      await boot({ CART_ADD_DELAY_MS: "2000" });
      say("Cart is a virtual object: one cart per customer key, state stored by Restate.");
      say("The URL includes the key: Cart/<customer>/<handler>.");
      await showCall("Cart/dana/add", { sku: "MUG", priceCents: 1500 });
      await showCall("Cart/dana/view");
      say("The state lives in Restate, not in a database we run. Look at it with the CLI:");
      cli(["state", "get", "Cart", "dana"]);
      await pause();

      say(bold("One at a time per key."));
      say("Each add takes 2 seconds (we slowed it down). Send three adds at once: two for");
      say("dana and one for sam.");
      await predict("Roughly how long until all three finish?", ["About 2 seconds", "About 4 seconds", "About 6 seconds"]);
      const t0 = Date.now();
      const timed = async (key: string, sku: string) => {
        await call(`Cart/${key}/add`, { sku, priceCents: 1000 });
        return `${key} +${sku} done after ${((Date.now() - t0) / 1000).toFixed(1)}s`;
      };
      const results = await Promise.all([timed("dana", "PEN"), timed("dana", "INK"), timed("sam", "HAT")]);
      results.forEach((r) => say(r));
      reveal("b. About 4s. Dana's two adds ran one after the other (never at the same time, so");
      reveal("neither can overwrite the other's change). Sam's ran in parallel with Dana's.");
      reveal("This is how Restate avoids race conditions without locks or a database.");
      await pause();

      say(bold("Checkout from the cart."));
      const out = await showCall<string>("Cart/dana/checkout", "123 Main St, Bozeman MT");
      await showCall("Cart/dana/view");
      say(`The cart is empty, and order ${bold(String(out.body))} was handed to Orders/checkout.`);
    },
  },

  // -------------------------------------------------------------------------
  "3.8": {
    title: "Workflows and durable promises",
    async run() {
      await boot();
      say("Returns is a workflow: one run per return id, which waits for a person's decision.");
      const { body } = await showCall<{ invocationId: string }>(
        "Returns/return-38/run",
        { orderId: "order-38", amountCents: 4999, reason: "arrived broken" },
        { send: true },
      );
      await sleep(800);
      say("While it waits, anyone can check its status through another handler:");
      await showCall("Returns/return-38/status");
      say(`Invocation status: ${bold(invocationStatus(body.invocationId))}. It's parked on the promise "decision".`);
      await pause();

      say("A support agent approves the return. Their tool calls the decide handler:");
      await showCall("Returns/return-38/decide", { approved: true, by: "sam@support" });
      await waitForStatus(body.invocationId, "completed");
      await showCall("Returns/return-38/status");
      ledgerLine("order-38");
      await pause();

      await predict("Someone calls Returns/return-38/run again. What happens?", [
        "A second refund",
        "Restate refuses: a workflow runs exactly once per id",
      ]);
      await showCall("Returns/return-38/run", { orderId: "order-38", amountCents: 4999, reason: "again" });
      reveal("b. HTTP 409: the workflow method was already invoked. Exactly-once per key is");
      reveal("built in, which makes workflows a natural fit for signups, approvals, onboarding.");
    },
  },

  // -------------------------------------------------------------------------
  "3.9": {
    title: "Awakeables",
    async run() {
      await boot();
      fs.rmSync(PROVIDER_INBOX, { force: true });
      say("AsyncPayments/pay starts a payment with a provider that answers later via webhook.");
      const { body } = await showCall<{ invocationId: string }>("AsyncPayments/pay", { orderId: "order-39", amountCents: 4999 }, { send: true });
      await waitFor("the provider request", () => fs.existsSync(PROVIDER_INBOX));
      const request = JSON.parse(fs.readFileSync(PROVIDER_INBOX, "utf8").trim().split("\n")[0]);
      say(`The provider received the payment request with callback id:\n    ${bold(request.callbackId)}`);
      say(`Our invocation is waiting: ${bold(invocationStatus(body.invocationId))}`);
      await pause();

      say("Some time later, the provider calls back. With a real provider, your webhook");
      say("handler would make this call to Restate:");
      await showCall(`restate/awakeables/${request.callbackId}/resolve`, { status: "paid", providerRef: "prov_8812" });
      await waitForStatus(body.invocationId, "completed");
      say("Restate woke the invocation with the provider's answer. Its result:");
      const out = await fetch(`http://localhost:8080/restate/invocation/${body.invocationId}/output`);
      console.log("    " + (await out.text()) + "\n");
      reveal("The wait could have lasted days and survived any number of crashes: the awakeable");
      reveal("is in the journal, and Restate held it until the answer arrived.");
    },
  },

  // -------------------------------------------------------------------------
  "3.10": {
    title: "Sagas",
    async run() {
      await boot();
      say("OrderSaga/checkout does three things, in this order:");
      say("  1. reserve the stock   2. charge the card   3. hand the box to the carrier");
      console.log();
      say(`A customer places ${bold("order-310")} and types their address as ${red('"Nowhere"')}.`);
      say("That isn't a real address: no street number, no town. Nothing checks it at");
      say("checkout, so the order starts normally. The carrier will refuse it, but only at");
      say("step 3, after the stock is reserved and the card is already charged.");
      await predict("When the carrier refuses the address, what should happen to the ledger?", [
        "reserve, charge, and the order is stuck (a very unhappy customer)",
        "reserve, charge, then refund and release: the finished steps are undone",
        "nothing at all",
      ]);
      const r = await showCall("OrderSaga/checkout", ORDER("order-310", { address: "Nowhere" }));
      say(`The carrier's answer came back as a TerminalError: ${red(String((r.body as { message?: string })?.message ?? ""))}`);
      say("And this is what the saga did about it (from the service's log):");
      const sagaLog = fs.readFileSync(path.join(RUNTIME_DIR, "service.log"), "utf8").split("\n").filter((l) => l.includes("order-310 failed"));
      sagaLog.slice(-1).forEach((l) => console.log("    " + l.replace(/^\[restate\]\[[^\]]*\]/, "").trim()));
      console.log();
      ledgerLine("order-310");
      reveal("b. Read the ledger top to bottom: reserve, charge, then refund, then release. Each");
      reveal("finished step registered how to undo itself; on the TerminalError the saga ran");
      reveal("the undo steps newest first, then reported the failure to the caller.");
      reveal("Why undo instead of retry? A carrier OUTAGE would be retried: it will pass. An");
      reveal("address that doesn't exist will never be deliverable, so it's a terminal error.");
    },
  },

  // -------------------------------------------------------------------------
  "3.11": {
    title: "Inspecting everything",
    async run() {
      await boot({ PICKUP_WAIT_SECONDS: "1" });
      say("Generate some traffic: two good orders, one declined card, one cart.");
      await call("Orders/checkout", ORDER("order-a"));
      await call("Orders/checkout", ORDER("order-b"));
      setFault("bank.charge", { mode: "decline", times: 1 });
      await call("Orders/checkout", ORDER("order-c"));
      await call("Cart/lee/add", { sku: "MUG", priceCents: 1500 });
      await sleep(2500);

      say(bold("1. What's happening right now?"));
      cli(["invocations", "list", "--all"]);
      say(bold("2. SQL: count invocations by handler and status"));
      showSql("SELECT target, status, count(*) AS n FROM sys_invocation GROUP BY target, status ORDER BY target");
      say(bold("3. SQL: which invocations failed, and why?"));
      showSql("SELECT id, target, completion_failure FROM sys_invocation WHERE completion_result = 'failure'");
      say(bold("3b. Anything still retrying? The CLI list shows retry counts:"));
      cli(["invocations", "list"]);
      say(bold("4. SQL: read a journal"));
      showSql(
        "SELECT index, entry_type, name FROM sys_journal WHERE id = (SELECT id FROM sys_invocation WHERE target = 'Orders/checkout' LIMIT 1) ORDER BY index",
      );
      say(bold("5. SQL: read virtual object state"));
      showSql("SELECT service_name, service_key, key, value_utf8 FROM state");
      say(bold("6. The web UI"));
      say("Restate ships a UI at http://localhost:9070/ui with the same views, clickable.");
      say("If you're running this lesson on your own machine, open it now: the server");
      say("stays up until you press Enter.");
      await pause("Press Enter to stop the server…");
      reveal("Most support investigations are steps 1–4: find the invocation, read its status");
      reveal("and last error, read its journal. Run `npx restate sql --help` to see every table.");
    },
  },
};

// ---------------------------------------------------------------------------
const requested = process.argv[2];
const ids = requested ? [requested] : Object.keys(lessons);
for (const id of ids) {
  const lesson = lessons[id];
  if (!lesson) {
    console.error(`No lesson ${id}. Available: ${Object.keys(lessons).join(", ")}`);
    process.exit(2);
  }
  clearLedger();
  clearFaults();
  fs.rmSync(path.join(RUNTIME_DIR, "supplier-fixed"), { force: true });
  heading(`Lesson ${id} · ${lesson.title}`);
  try {
    await lesson.run();
  } catch (err) {
    console.error("\n" + red("✘ " + explainError(err)) + "\n");
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
  if (process.exitCode) break;
  if (ids.length > 1) await pause("Lesson done. Press Enter for the next one…");
}
console.log();
process.exit(process.exitCode ?? 0);
