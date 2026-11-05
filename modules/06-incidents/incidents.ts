/**
 * Module 6: incidents. Each one plays out a real support ticket on Restate:
 * the customer's message, a reproduction, the investigation (with the same CLI
 * output you'd see on a call), the root cause, the fix, and a check that the
 * fix worked.
 *
 *   npm run m6 -- 6.2     run one incident
 *   npm run m6            run them all
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
import { bad, bold, explainError, cyan, good, heading, pause, predict, red, reveal, say, sleep } from "../../shared/term.js";
import { SUPPLIER_KEY_FILE } from "./services/stock-sync.js";

const APP = "modules/06-incidents/services/app.ts";
const ORDER = (orderId: string, extra: Record<string, unknown> = {}) => ({
  orderId,
  sku: "SKU-42",
  amountCents: 4999,
  address: "123 Main St, Bozeman MT",
  ...extra,
});

function ticket(from: string, subject: string, body: string) {
  console.log("\n" + bold(cyan("📨 Incoming ticket")));
  console.log(cyan(`   From:    ${from}`));
  console.log(cyan(`   Subject: ${subject}`));
  for (const line of body.trim().split("\n")) console.log(cyan(`   │ ${line.trim()}`));
  console.log();
}

function step(n: number, text: string) {
  console.log("\n" + bold(`── ${n}. ${text} ` + "─".repeat(Math.max(0, 60 - text.length))));
}

function ledgerLine(orderId: string) {
  const entries = readLedger().filter((e) => e.orderId === orderId);
  console.log("  Ledger for " + bold(orderId) + ":");
  if (!entries.length) console.log("    (nothing happened)");
  for (const e of entries) console.log(`    ${e.system.padEnd(9)} ${e.action.padEnd(20)} ${e.detail}`);
}

async function boot(file = APP, env: Record<string, string> = {}) {
  await startServer();
  const svc = new Service(file, env);
  await svc.start();
  register();
  return svc;
}

const incidents: Record<string, { title: string; run: () => Promise<void> }> = {
  // =========================================================================
  "6.1": {
    title: "Crash mid-order",
    async run() {
      ticket(
        "Dana Reyes, Platform Lead, Northwind Outfitters",
        "Order service crashed mid-checkout — are orders lost??",
        `Our order service ran out of memory and was down for a few minutes before
         Kubernetes restarted it. We had checkouts in flight. Finance wants to know if
         customers were charged without their orders shipping, and whether we need to
         re-run anything. Example order: order-1001.`,
      );
      step(1, "Reproduce");
      const svc = await boot(APP, { PICKUP_WAIT_SECONDS: "8" });
      const { body } = await showCall<{ invocationId: string }>("Orders/checkout", ORDER("order-1001"), { send: true, idempotencyKey: "order-1001" });
      await waitFor("the charge", () => countFor("order-1001", "bank", "charge") === 1);
      await svc.kill();
      bad("Service killed mid-order (the OOM).");
      await sleep(9000);

      step(2, "Investigate: what does Restate think happened?");
      say("Find the order by its idempotency key, then describe it:");
      showSql("SELECT id, target, created_at FROM sys_invocation WHERE idempotency_key = 'order-1001'");
      cli(["invocations", "describe", body.invocationId]);
      await predict("Based on that output, what do you tell Dana?", [
        "The order is lost; re-run it",
        "The order is safe: charged once, waiting for the service, will resume on its own",
        "The customer may have been charged twice",
      ]);
      reveal("b. backing-off + 'Connection refused' = Restate retrying a dead service. The journal");
      reveal("shows the charge completed and recorded, so it won't run again.");

      step(3, "Resolve");
      await svc.start();
      cli(["invocations", "resume", body.invocationId, "--yes"]);
      await waitForStatus(body.invocationId, "completed");

      step(4, "Verify against the system of record");
      ledgerLine("order-1001");
      good("One charge, one shipment. Nothing to re-run.");
    },
  },

  // =========================================================================
  "6.2": {
    title: "The double charge",
    async run() {
      ticket(
        "Marco Ruiz, Payments Engineer, Brightside Coffee",
        "Restate charged a customer twice!!",
        `A customer was charged twice for order bc-7731 yesterday. Our payment
         provider's dashboard shows two $49.99 charges eight seconds apart. We moved to
         Restate specifically to stop this. Is exactly-once broken?`,
      );
      step(1, "Reproduce");
      say("The payment provider's response is lost once (a timeout after it charged):");
      await boot();
      setFault("bank.charge", { mode: "lost-response", times: 1 });
      await showCall("LegacyCheckout/checkout", ORDER("bc-7731"));

      step(2, "Investigate");
      say("System of record first:");
      ledgerLine("bc-7731");
      say("Now Restate's view of the order:");
      const [inv] = sql<{ id: string }>("SELECT id FROM sys_invocation WHERE target = 'LegacyCheckout/checkout'");
      cli(["invocations", "journal", inv.id]);
      say("And the service log around the charge:");
      const log = fs.readFileSync(path.join(RUNTIME_DIR, "service.log"), "utf8").split("\n").filter((l) => /charge|timed out|retry/i.test(l));
      log.slice(-4).forEach((l) => console.log("    " + l.slice(0, 160)));
      await predict("What's the root cause?", [
        "A bug in Restate's replay",
        "The charge step was retried after an ambiguous timeout, and the bank call has no idempotency key",
        "The client sent the request twice",
      ]);
      reveal("b. The journal shows ONE checkout and ONE completed 'charge card' step, so Restate's");
      reveal("record is right: the step completed once. But its first attempt timed out AFTER the");
      reveal("bank charged, and the retry (correctly) ran the step again. Without an idempotency");
      reveal("key, the bank treated the retry as a new charge. Restate guarantees each step");
      reveal("completes once; it can't know what the bank did before the timeout (lesson 2.4).");

      step(3, "Fix: pass a stable idempotency key to the bank");
      say("Same fault, same order flow, on FixedCheckout (see services/legacy-checkout.ts):");
      setFault("bank.charge", { mode: "lost-response", times: 1 });
      await showCall("FixedCheckout/checkout", ORDER("bc-7732"));
      ledgerLine("bc-7732");
      good("One charge. The retry carried the same key and the bank returned the original result.");
    },
  },

  // =========================================================================
  "6.3": {
    title: "The deploy that broke running orders",
    async run() {
      ticket(
        "Priya Shah, Backend Lead, Wrapt Gifts",
        "Orders stuck after deploy with 'mismatch between the code paths'",
        `We deployed a small feature (a gift-wrapping email) at 14:05. Orders placed
         after the deploy are fine. But some orders placed BEFORE it are now stuck
         retrying with error RT0016 "Found a mismatch between the code paths taken
         during the previous execution and the paths taken during this execution".
         Not all of them — maybe 1 in 20. What did we break?`,
      );
      step(1, "Reproduce the deploy, the way Wrapt did it");
      await startServer();
      const v1 = new Service("modules/06-incidents/services/gift-v1.ts");
      await v1.start();
      register();
      const { body } = await showCall<{ invocationId: string }>(
        "GiftOrders/checkout",
        ORDER("wr-501", { pickupSeconds: 8 }),
        { send: true },
      );
      await waitForStatus(body.invocationId, "suspended", 10_000);
      say("Order wr-501 is waiting for pickup on v1. Now the deploy: stop v1, start v2 at the");
      say("same URL, re-register with --force.");
      await v1.kill();
      const v2 = new Service("modules/06-incidents/services/gift-v2.ts");
      await v2.start();
      register("http://localhost:9080", { force: true, show: true });
      await sleep(9500);

      step(2, "Investigate");
      cli(["invocations", "describe", body.invocationId]);
      await predict("Why only ~1 in 20 old orders, and not all of them?", [
        "Random network errors",
        "Only orders that had already passed 'reserve inventory' when v2 took over hit the new email step at a journal position already used by 'charge card'",
        "Restate only retries some orders",
      ]);
      reveal("b. The error names the exact difference: journal entry 2 was 'charge card', the new");
      reveal("code asks for 'send gift email' there. Orders that hadn't reserved yet don't conflict;");
      reveal("orders that had already passed that point do. Hence 'some, not all'.");
      reveal("The real mistake was the deploy method: --force replaced v1 IN PLACE, so in-flight");
      reveal("orders were sent to v2's code. Restate normally pins each invocation to the");
      reveal("deployment it started on.");
      await pause();

      step(3, "Mitigate: roll back so stuck orders recover");
      await v2.kill();
      await v1.start();
      register("http://localhost:9080", { force: true });
      cli(["invocations", "resume", body.invocationId, "--yes"]);
      await waitForStatus(body.invocationId, "completed");
      ledgerLine("wr-501");
      good("Back on v1's code, the journal lines up again and wr-501 shipped.");
      await pause();

      step(4, "Fix: deploy v2 alongside v1, as a new deployment");
      const { body: b2 } = await showCall<{ invocationId: string }>("GiftOrders/checkout", ORDER("wr-502", { pickupSeconds: 6 }), { send: true });
      await waitForStatus(b2.invocationId, "suspended", 10_000);
      const v2b = new Service("modules/06-incidents/services/gift-v2.ts", {}, 9081);
      await v2b.start();
      say("v2 runs at a NEW URL (port 9081) and is registered as a new deployment. v1 keeps running.");
      register("http://localhost:9081", { force: false, show: true });
      await showCall("GiftOrders/checkout", ORDER("wr-503", { pickupSeconds: 1 }));
      showSql("SELECT id, status, pinned_deployment_id FROM sys_invocation WHERE target = 'GiftOrders/checkout' ORDER BY created_at");
      await waitForStatus(b2.invocationId, "completed", 20_000);
      cli(["deployments", "list"]);
      reveal("Old orders finish on v1 (their pinned deployment); new orders run on v2. Once no");
      reveal("invocations are pinned to v1, it can be shut down and removed.");
    },
  },

  // =========================================================================
  "6.4": {
    title: "The stuck workflow nobody noticed",
    async run() {
      ticket(
        "Sam Okafor, Ops, Fernhill Grocers",
        "Stock levels haven't updated since yesterday",
        `Our nightly stock sync usually finishes in a minute. Since yesterday, store
         managers say stock levels are frozen. The Restate dashboard shows nothing
         failed. Restate is up. What's going on?`,
      );
      step(1, "Reproduce");
      fs.rmSync(SUPPLIER_KEY_FILE, { force: true });
      await boot();
      for (const sku of ["APPLES", "BREAD", "MILK", "EGGS", "COFFEE"]) await call("StockSync/sync", sku, { send: true });
      await sleep(6000);

      step(2, "Investigate: \"nothing failed\" — but is anything still running?");
      say("Nothing has FAILED, so a failures dashboard stays empty. List what's still in flight:");
      cli(["invocations", "list"]);
      const [first] = sql<{ id: string }>("SELECT id FROM sys_invocation WHERE target = 'StockSync/sync' LIMIT 1");
      cli(["invocations", "describe", first.id]);
      await predict("What's going on?", [
        "Restate lost the syncs",
        "All five are retrying a permanent-looking error (401), quietly, with the default retry policy",
        "The syncs are waiting on a timer",
      ]);
      reveal("b. Every sync is backing off on '401 Unauthorized'. An ordinary Error is treated as");
      reveal("transient, so Restate keeps retrying: by default up to 70 attempts over about an hour,");
      reveal("then it pauses them. Nothing is lost, but nothing alerted anyone either.");
      await pause();

      step(3, "Resolve: fix the cause, then retry everything now");
      say("Ops puts the new supplier API key into the config:");
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      fs.writeFileSync(SUPPLIER_KEY_FILE, "new-key");
      say("Then retry every StockSync/sync invocation now, instead of waiting for the backoff:");
      cli(["invocations", "resume", "StockSync/sync", "--yes"]);
      await waitFor("all syncs to finish", () => sql("SELECT id FROM sys_invocation WHERE status != 'completed'").length === 0, 20_000);
      showSql("SELECT target, status, completion_result, count(*) AS n FROM sys_invocation GROUP BY target, status, completion_result");
      good("All five syncs completed once the key was fixed. No work was lost.");
      reveal("Prevention: alert on invocations that keep retrying (Restate's metrics endpoint, or a");
      reveal("scheduled check of `restate invocations list`), and decide deliberately which errors");
      reveal("are terminal (lesson 3.5).");
    },
  },

  // =========================================================================
  "6.5": {
    title: "The timeout that caused duplicates",
    async run() {
      ticket(
        "Lena Novak, Mobile Lead, Kestrel Outdoor",
        "Customers getting two orders from one tap",
        `Since we added an 8-second warehouse check to checkout, some customers get
         two identical orders. Our mobile app calls our API gateway, which calls
         Restate. The gateway times out after 5 seconds, and the app retries on
         timeout. We never retried more than once.`,
      );
      step(1, "Reproduce: a client with a 5-second timeout that retries once");
      await boot(APP, { PICKUP_WAIT_SECONDS: "8" });
      const gateway = async (orderId: string, idempotencyKey?: string) => {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await fetch("http://localhost:8080/Orders/checkout", {
              method: "POST",
              headers,
              body: JSON.stringify(ORDER(orderId)),
              signal: AbortSignal.timeout(5000),
            });
            say(`gateway attempt ${attempt}: HTTP ${res.status}`);
            return;
          } catch {
            say(red(`gateway attempt ${attempt}: timed out after 5s, retrying`));
          }
        }
      };
      await gateway("ks-88");
      await sleep(9000);

      step(2, "Investigate");
      ledgerLine("ks-88");
      showSql("SELECT id, status, idempotency_key, created_at FROM sys_invocation WHERE target = 'Orders/checkout'");
      await predict("Why two orders?", [
        "Restate ran the checkout twice by itself",
        "The client's timeout didn't stop the first request; the retry started a second, separate checkout",
        "The bank duplicated the charge",
      ]);
      reveal("b. Two invocations with different (auto-generated) idempotency keys. A client-side");
      reveal("timeout only means the CLIENT stopped waiting: the first checkout kept running on");
      reveal("Restate and completed. The retry looked like a brand-new order.");
      reveal("Look closely at the ledger: the bank ignored the second charge, because the Payments");
      reveal("service already sends an idempotency key. But stock was reserved twice, two emails went");
      reveal("out and two boxes shipped. Protecting one step isn't the same as protecting the order.");
      await pause();

      step(3, "Fix: send a stable idempotency key with every attempt");
      clearLedger();
      await gateway("ks-89", "ks-89");
      await sleep(9000);
      ledgerLine("ks-89");
      showSql("SELECT id, status, idempotency_key FROM sys_invocation WHERE idempotency_key = 'ks-89'");
      good("One order. The retry attached to the first invocation instead of starting another.");
      reveal("Even better for slow flows: submit with /send (returns at once with an invocation id)");
      reveal("and fetch the result later, so gateway timeouts never come into play.");
    },
  },

  // =========================================================================
  "6.6": {
    title: "The hot key",
    async run() {
      ticket(
        "Ana Lima, Engineering Manager, Tidepool Books",
        "Cart is slow for some customers, fine for others",
        `Adding to cart normally takes ~50ms. For some customers it sometimes takes
         10+ seconds. It started after we launched loyalty rewards. It's always
         specific customers, never everyone at once.`,
      );
      step(1, "Reproduce");
      await boot(APP, { PARTNER_API_SECONDS: "10" });
      say("A rewards recalculation starts for customer 'ana' (it calls a slow partner API)…");
      await call("LoyaltyCart/ana/recalculateRewards", undefined, { send: true });
      await sleep(500);
      const t0 = Date.now();
      const slow = call("LoyaltyCart/ana/add", { sku: "NOVEL", priceCents: 1800 }).then(() => (Date.now() - t0) / 1000);
      const t1 = Date.now();
      await call("LoyaltyCart/ben/add", { sku: "NOVEL", priceCents: 1800 });
      say(`ben's add-to-cart: ${((Date.now() - t1) / 1000).toFixed(2)}s`);
      await sleep(1000);

      step(2, "Investigate (while ana's add is still waiting)");
      cli(["invocations", "list", "--service", "LoyaltyCart", "--key", "ana"]);
      say(`ana's add-to-cart finally returned after ${(await slow).toFixed(1)}s`);
      await predict("Why is only ana slow?", [
        "ana's cart has too many items",
        "recalculateRewards is an exclusive handler; while it waits on the partner API, every other request for ana's cart queues behind it",
        "The partner API is rate-limiting ana",
      ]);
      reveal("b. Virtual objects run one exclusive handler at a time PER KEY (lesson 3.7). A slow");
      reveal("exclusive handler turns that key into a hot key. Other keys are unaffected.");
      await pause();

      step(3, "Fix: do the slow work outside the queue");
      say("refreshRewards is a SHARED handler: it calls the partner API without holding ana's");
      say("queue, then stores the result with a quick exclusive call.");
      await call("LoyaltyCart/ana/refreshRewards", undefined, { send: true });
      await sleep(500);
      const t2 = Date.now();
      await call("LoyaltyCart/ana/add", { sku: "ATLAS", priceCents: 2500 });
      good(`ana's add-to-cart during a rewards refresh: ${((Date.now() - t2) / 1000).toFixed(2)}s`);
    },
  },

  // =========================================================================
  "6.7": {
    title: "Nobody is listening",
    async run() {
      ticket(
        "Jordan Pike, Developer, Lumen Labs (trial account)",
        "Getting 'service not found' — Restate is broken?",
        `Following the quickstart. My service is running (I can see 'listening on
         9080'), Restate is running, but every request returns an error saying the
         service isn't found. I've restarted everything twice.`,
      );
      step(1, "Reproduce: everything running, but the service was never registered");
      await startServer();
      const svc = new Service(APP);
      await svc.start();
      await showCall("Orders/checkout", ORDER("lm-1"));

      step(2, "Investigate");
      cli(["deployments", "list"], { allowFail: true });
      cli(["services", "list"], { allowFail: true });
      await predict("What's missing?", [
        "The service has a bug",
        "Restate doesn't know the service exists: no deployment is registered",
        "Port 8080 is blocked",
      ]);
      reveal("b. Restate only routes to registered deployments. The service being up isn't");
      reveal("enough: Restate needs to be told where it is (lesson 3.2).");

      step(3, "Resolve");
      register("http://localhost:9080", { show: true });
      await showCall("Orders/checkout", ORDER("lm-1", { }));
      good("Works.");
      reveal("Temporal's version of this ticket is a worker polling the wrong task queue or");
      reveal("namespace: work waits silently instead of erroring (lesson 4.4).");
      await svc.kill();
    },
  },
};

// ---------------------------------------------------------------------------
const requested = process.argv[2];
const ids = requested ? [requested] : Object.keys(incidents);
for (const id of ids) {
  const incident = incidents[id];
  if (!incident) {
    console.error(`No incident ${id}. Available: ${Object.keys(incidents).join(", ")}`);
    process.exit(2);
  }
  clearLedger();
  clearFaults();
  heading(`Incident ${id} · ${incident.title}`);
  try {
    await incident.run();
  } catch (err) {
    console.error("\n" + red("✘ " + explainError(err)) + "\n");
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
  if (process.exitCode) break;
  if (ids.length > 1) await pause("Incident closed. Press Enter for the next one…");
}
console.log();
process.exit(process.exitCode ?? 0);
