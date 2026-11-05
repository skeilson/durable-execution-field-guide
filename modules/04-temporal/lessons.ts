/**
 * Module 4 hands-on lessons. Each one starts a fresh Temporal dev server (in
 * memory), and usually a worker, then does something real.
 *
 *   npm run m4 -- 4.4     run one lesson
 *   npm run m4            run them all in order
 *
 * Needs the Temporal CLI (lesson 4.2). Nothing else should be using ports
 * 7233 or 8233.
 */
import { WorkflowFailedError } from "@temporalio/client";
import { Worker as ReplayWorker } from "@temporalio/worker";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearFaults, clearLedger, readLedger, RUNTIME_DIR, setFault } from "../../shared/fake-world.js";
import { waitFor } from "../../shared/restate-harness.js";
import {
  getClient,
  shutdownTemporal,
  startTemporal,
  TASK_QUEUE,
  tcli,
  waitForWorkflow,
  Worker,
} from "../../shared/temporal-harness.js";
import { bad, bold, explainError, good, heading, pause, predict, red, reveal, say, sleep } from "../../shared/term.js";
import type { CartItem, Order } from "./shop/workflows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = (orderId: string, extra: Partial<Order> & Record<string, unknown> = {}): Order => ({
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

/** Show a client call the way the equivalent CLI command would look. */
function showStart(type: string, workflowId: string, input: unknown) {
  console.log(`\n  $ temporal workflow start --type ${type} --task-queue ${TASK_QUEUE} --workflow-id ${workflowId} --input '${JSON.stringify(input)}'\n`);
}

async function boot(withWorker = true) {
  say("Starting a fresh Temporal dev server" + (withWorker ? " and a worker…" : "…"));
  const client = await startTemporal();
  const worker = new Worker();
  if (withWorker) await worker.start();
  return { client, worker };
}

const lessons: Record<string, { title: string; run: () => Promise<void> }> = {
  // -------------------------------------------------------------------------
  "4.2": {
    title: "The dev server and Web UI",
    async run() {
      await boot(false);
      say("The dev server is running: the Temporal service on port 7233, the Web UI on 8233.");
      tcli(["operator", "namespace", "list"]);
      say("A fresh server has no workflows yet:");
      tcli(["workflow", "list"]);
      say("Open http://localhost:8233 in your browser to see the Web UI.");
      await pause("Press Enter to stop the server…");
    },
  },

  // -------------------------------------------------------------------------
  "4.3": {
    title: "Workflows and activities",
    async run() {
      const { client } = await boot();
      say("Run the greet workflow from the command line and wait for its result:");
      tcli(["workflow", "execute", "--type", "greet", "--task-queue", TASK_QUEUE, "--workflow-id", "greet-1", "--input", '"Dana"']);
      await pause();

      say("Now checkout: reserve, charge, email, wait 3s, ship. Started from code this time:");
      showStart("checkout", "order-43", ORDER("order-43", { pickupSeconds: 3 }));
      const result = await client.workflow.execute("checkout", {
        taskQueue: TASK_QUEUE,
        workflowId: "order-43",
        args: [ORDER("order-43", { pickupSeconds: 3 })],
      });
      console.log("    → " + JSON.stringify(result) + "\n");
      ledgerLine("order-43");
      say("Temporal's journal is called the EVENT HISTORY. Here it is:");
      tcli(["workflow", "show", "--workflow-id", "order-43"]);
      reveal("Every activity appears as Scheduled → Started → Completed, and the timer as");
      reveal("TimerStarted → TimerFired. Between them, WorkflowTask events are the worker");
      reveal("running your workflow code to decide what to do next.");
    },
  },

  // -------------------------------------------------------------------------
  "4.4": {
    title: "Workers and task queues",
    async run() {
      const { client, worker } = await boot(false);
      say("This time NO worker is running. Start a checkout anyway:");
      showStart("checkout", "order-44", ORDER("order-44", { pickupSeconds: 8 }));
      await client.workflow.start("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-44", args: [ORDER("order-44", { pickupSeconds: 8 })] });
      await predict("No worker exists. What does Temporal report for this workflow?", [
        "An error: no worker available",
        "Running, with nothing happening and no error",
        "Failed",
      ]);
      await sleep(3000);
      tcli(["workflow", "describe", "--workflow-id", "order-44"]);
      reveal("b. Running, with a pending workflow task and no error anywhere. Temporal put the");
      reveal("work on the task queue and is waiting for a worker to poll it. Here's the proof:");
      tcli(["task-queue", "describe", "--task-queue", TASK_QUEUE]);
      reveal("No pollers. On a Temporal ticket where \"nothing is happening\", this is the");
      reveal("first thing to check. (Compare Restate, which reports connection errors.)");
      await pause();

      say("Start a worker. It polls the queue and picks up the waiting work:");
      await worker.start();
      await waitFor("the charge", () => readLedger().some((e) => e.orderId === "order-44" && e.action === "charge"));
      say("Card charged; the workflow is now in its 8-second pickup timer. Kill the worker:");
      await worker.kill();
      bad("Worker killed.");
      await sleep(1000);
      tcli(["workflow", "describe", "--workflow-id", "order-44"]);
      say("Still Running. The server holds the timer; it doesn't need a worker until it fires.");
      say("Bring a worker back:");
      await worker.start();
      await waitForWorkflow("order-44", ["COMPLETED"], 30_000);
      ledgerLine("order-44");
      good("One charge, one shipment. The new worker replayed the history and carried on.");
    },
  },

  // -------------------------------------------------------------------------
  "4.5": {
    title: "Retries, timeouts and failures",
    async run() {
      const { client, worker } = await boot();

      say(bold("A) The bank returns 503 four times, then recovers."));
      setFault("bank.charge", { mode: "error", times: 4 });
      await client.workflow.start("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-45a", args: [ORDER("order-45a", { pickupSeconds: 1 })] });
      await sleep(2000);
      say("While it's retrying, describe shows the pending activity, its attempt count and last failure:");
      tcli(["workflow", "describe", "--workflow-id", "order-45a"]);
      await waitForWorkflow("order-45a", ["COMPLETED"]);
      ledgerLine("order-45a");
      await pause();

      say(bold("B) The card is declined: a non-retryable ApplicationFailure."));
      setFault("bank.charge", { mode: "decline", times: 1 });
      await predict("What happens to the checkout workflow?", [
        "It retries the charge forever",
        "The activity fails at once and, since checkout doesn't catch it, the workflow fails",
        "The workflow pauses",
      ]);
      try {
        await client.workflow.execute("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-45b", args: [ORDER("order-45b")] });
      } catch (err) {
        if (!(err instanceof WorkflowFailedError)) throw err;
        console.log(`    → workflow failed: ${err.cause?.message}\n`);
      }
      tcli(["workflow", "describe", "--workflow-id", "order-45b"]);
      ledgerLine("order-45b");
      reveal("b. Non-retryable failures skip the retry policy. The failure reaches the workflow,");
      reveal("which could catch it (lesson 4.9). Unhandled, it fails the whole workflow.");
      await pause();

      say(bold("C) A retry limit: the supplier API is down, and inventorySync allows 4 attempts."));
      await client.workflow.start("inventorySync", { taskQueue: TASK_QUEUE, workflowId: "sync-45c", args: ["SKU-42"] });
      await predict("After 4 failed attempts, what does Temporal do?", [
        "Pause, like Restate",
        "Fail the activity; unhandled, the workflow fails",
        "Keep retrying anyway",
      ]);
      await waitForWorkflow("sync-45c", ["FAILED"], 30_000);
      tcli(["workflow", "describe", "--workflow-id", "sync-45c"]);
      reveal("b. When attempts run out, the activity fails and the workflow decides what to do.");
      reveal("Here it fails. Restate's default pauses instead; a real difference to remember.");
      await pause();

      say(bold("D) A bug in WORKFLOW code, not in an activity."));
      say("printLabel assumes every order has a gift message. This one doesn't.");
      await client.workflow.start("printLabel", { taskQueue: TASK_QUEUE, workflowId: "label-45d", args: [ORDER("label-45d")] });
      await sleep(3000);
      tcli(["workflow", "describe", "--workflow-id", "label-45d"]);
      say("Status: still Running. Look at the history:");
      tcli(["workflow", "show", "--workflow-id", "label-45d"]);
      reveal("WorkflowTaskFailed, retried again and again. An ordinary error in workflow code");
      reveal("doesn't fail the workflow: Temporal assumes it's a bug and waits for a fix to be");
      reveal("deployed. Then the workflow continues. Here, we'll just terminate it:");
      tcli(["workflow", "terminate", "--workflow-id", "label-45d", "--reason", "lesson over"]);
      await worker.kill();
    },
  },

  // -------------------------------------------------------------------------
  "4.6": {
    title: "Timers",
    async run() {
      const { client, worker } = await boot();
      say("A reminder in 12 seconds:");
      showStart("reminder", "remind-46", ["cart-46", 12]);
      await client.workflow.start("reminder", { taskQueue: TASK_QUEUE, workflowId: "remind-46", args: ["cart-46", 12] });
      await sleep(1500);
      tcli(["workflow", "show", "--workflow-id", "remind-46"]);
      say("TimerStarted is in the history. Kill the worker:");
      await worker.kill();
      bad("Worker killed.");
      await predict("Does anything error while the timer waits with no worker?", ["Yes", "No"]);
      await sleep(2000);
      tcli(["workflow", "describe", "--workflow-id", "remind-46"]);
      reveal("No. The server holds the timer. When it fires, the next step waits on the task");
      reveal("queue for a worker, again without an error.");
      say("Start a worker again and wait for the reminder:");
      await worker.start();
      await waitForWorkflow("remind-46", ["COMPLETED"], 30_000);
      ledgerLine("cart-46");
    },
  },

  // -------------------------------------------------------------------------
  "4.7": {
    title: "Signals, queries and updates",
    async run() {
      const { client } = await boot();

      say("A running workflow can receive three kinds of message from outside:");
      say(`  ${bold("signal")}  send it data, don't wait for an answer      ("add a mug to the cart")`);
      say(`  ${bold("query")}   ask it a question, change nothing          ("what's in the cart?")`);
      say(`  ${bold("update")}  change it AND wait for an answer           ("check out, give me the order id")`);
      console.log();
      say(bold("A) Dana's cart: one long-running workflow per customer (workflow id cart-dana)."));
      const add = async (item: CartItem) => {
        await client.workflow.signalWithStart("cart", {
          taskQueue: TASK_QUEUE,
          workflowId: "cart-dana",
          args: ["dana"],
          signal: "addItem",
          signalArgs: [item],
        });
        say(`SIGNAL addItem → ${item.sku} ($${(item.priceCents / 100).toFixed(2)}). Sent; we don't wait for a reply.`);
      };
      say("The first signal also STARTS the cart workflow, because it doesn't exist yet");
      say("(this is called signal-with-start):");
      await add({ sku: "MUG", priceCents: 1500 });
      await add({ sku: "PEN", priceCents: 300 });
      const handle = client.workflow.getHandle("cart-dana");
      await sleep(500);
      const view = await handle.query<{ items: CartItem[]; totalCents: number }>("viewCart");
      say(`QUERY viewCart → ${view.items.map((i) => i.sku).join(" + ")}, total $${(view.totalCents / 100).toFixed(2)}`);
      say("The workflow answered from its own variables. Nothing changed, nothing was recorded.");
      await pause();
      await predict("Now an UPDATE asks the cart to check out. What does the caller get back?", [
        "Nothing: like a signal, it's fire and forget",
        "The new order id, once the workflow has finished reserving the stock",
        "An error, because a query is already running",
      ]);
      const orderId = await handle.executeUpdate<string, [string]>("checkoutCart", { args: ["123 Main St, Bozeman MT"] });
      say(`UPDATE checkoutCart → order ${bold(orderId)}`);
      reveal("b. The caller waited while the workflow reserved the stock, then got the order id.");
      await waitForWorkflow("cart-dana", ["COMPLETED"]);
      say("Checked out, so the cart workflow finished. Its history shows every message:");
      tcli(["workflow", "show", "--workflow-id", "cart-dana"]);
      reveal("Signals and updates are in the history (WorkflowExecutionSignaled,");
      reveal("WorkflowExecutionUpdateAccepted/Completed): replay re-delivers them in the same");
      reveal("order, so the cart rebuilds exactly. The query is not there: it only read.");
      await pause();

      say(bold("B) A return that waits for a human."));
      await client.workflow.start("returnRequest", {
        taskQueue: TASK_QUEUE,
        workflowId: "return-47",
        args: [{ orderId: "order-47", amountCents: 4999, reason: "arrived broken" }],
      });
      await sleep(800);
      const ret = client.workflow.getHandle("return-47");
      say(`Status query: ${bold(await ret.query<string>("status"))}`);
      say("A support agent approves it from the command line:");
      tcli(["workflow", "signal", "--workflow-id", "return-47", "--name", "decide", "--input", '{"approved":true,"by":"sam@support"}']);
      await waitForWorkflow("return-47", ["COMPLETED"]);
      say(`Status query: ${bold(await ret.query<string>("status"))}`);
      ledgerLine("order-47");
      await pause();

      say(bold("C) A webhook from a payment provider, delivered as a signal."));
      fs.rmSync(path.join(RUNTIME_DIR, "provider-inbox.jsonl"), { force: true });
      await client.workflow.start("asyncPayment", { taskQueue: TASK_QUEUE, workflowId: "pay-47", args: [{ orderId: "order-47c", amountCents: 4999 }] });
      const inbox = path.join(RUNTIME_DIR, "provider-inbox.jsonl");
      await waitFor("the provider request", () => fs.existsSync(inbox));
      const req = JSON.parse(fs.readFileSync(inbox, "utf8").trim().split("\n")[0]);
      say(`The provider was told to notify workflow ${bold(req.workflowId)}. Later, its webhook arrives,`);
      say("and our webhook endpoint forwards it as a signal:");
      await client.workflow.getHandle(req.workflowId).signal("paymentResult", { status: "paid", providerRef: "prov_8812" });
      console.log("    → " + JSON.stringify(await client.workflow.getHandle(req.workflowId).result()) + "\n");
    },
  },

  // -------------------------------------------------------------------------
  "4.8": {
    title: "Child workflows and continue-as-new",
    async run() {
      const { client } = await boot();
      say(bold("A) Child workflows: one batch, three orders, three children."));
      const orders = ["b1", "b2", "b3"].map((id) => ORDER(id, { pickupSeconds: 1 }));
      console.log("    → " + JSON.stringify(
        await client.workflow.execute("batchCheckout", { taskQueue: TASK_QUEUE, workflowId: "batch-48", args: [orders] }),
      ) + "\n");
      tcli(["workflow", "list", "--query", "WorkflowType = 'checkout'"]);
      reveal("Each child has its own id, history and status. The parent's history only");
      reveal("records that each child started and finished.");
      await pause();

      say(bold("B) Continue-as-new: a cart that receives 105 signals."));
      say("The cart workflow continues as new after 100 events, carrying its items along.");
      for (let i = 0; i < 105; i++) {
        await client.workflow.signalWithStart("cart", {
          taskQueue: TASK_QUEUE,
          workflowId: "cart-lee",
          args: ["lee"],
          signal: "addItem",
          signalArgs: [{ sku: `ITEM-${i}`, priceCents: 100 }],
        });
      }
      await sleep(2000);
      tcli(["workflow", "list", "--query", "WorkflowId = 'cart-lee'"]);
      const view = await client.workflow.getHandle("cart-lee").query<{ items: CartItem[] }>("viewCart");
      reveal(`Two runs with the same workflow id: the first ended "ContinuedAsNew", the second is`);
      reveal(`running with a fresh history and all ${view.items.length} items. Long-lived workflows do`);
      reveal("this to keep their history from growing without limit.");
      await client.workflow.getHandle("cart-lee").terminate("lesson over");
    },
  },

  // -------------------------------------------------------------------------
  "4.9": {
    title: "Sagas",
    async run() {
      const { client } = await boot();
      say("orderSaga reserves the stock, charges the card, then hands the box to the carrier.");
      say(`This order's address is ${red('"Nowhere"')}: no street number, so the carrier will`);
      say("refuse it at the last step, after the card is already charged. Same story as");
      say("lesson 3.10, now on Temporal.");
      await predict("When the carrier refuses the address, what does the ledger show?", [
        "reserve, charge (stuck)",
        "reserve, charge, refund, release",
        "nothing",
      ]);
      try {
        await client.workflow.execute("orderSaga", { taskQueue: TASK_QUEUE, workflowId: "saga-49", args: [ORDER("order-49", { address: "Nowhere" })] });
      } catch (err) {
        if (!(err instanceof WorkflowFailedError)) throw err;
        console.log(`    → workflow failed: ${err.cause?.message}\n`);
      }
      ledgerLine("order-49");
      reveal("b. Same pattern as Restate (lesson 3.10). The compensations are activities, so they");
      reveal("get the same retries and durability as everything else.");
    },
  },

  // -------------------------------------------------------------------------
  "4.10": {
    title: "Determinism, versioning and replay testing",
    async run() {
      const { client, worker } = await boot();

      say(bold("A) Replay testing: check a code change against real history, offline."));
      say("Run giftOrder to completion on the current code and save its history:");
      await client.workflow.execute("giftOrder", { taskQueue: TASK_QUEUE, workflowId: "gift-410a", args: [ORDER("gift-410a", { pickupSeconds: 1 })] });
      const history = await client.workflow.getHandle("gift-410a").fetchHistory();
      fs.writeFileSync(path.join(RUNTIME_DIR, "gift-410a-history.json"), JSON.stringify(history));
      say(`Saved ${history.events?.length} events. Now replay that history against two changed versions:`);
      const replay = async (file: string) => {
        try {
          await ReplayWorker.runReplayHistory({ workflowsPath: path.join(here, "shop", file) }, history);
          good(`${file}: replays cleanly`);
        } catch (err) {
          bad(`${file}: ${(err as Error).name}: ${(err as Error).message.split("\n")[0]}`);
        }
      };
      await predict("workflows-changed.ts adds an email step between reserve and charge. Replay result?", [
        "Replays cleanly",
        "Non-determinism error",
      ]);
      await replay("workflows-changed.ts");
      await replay("workflows-patched.ts");
      reveal("The unguarded change breaks replay; the same change behind patched() doesn't.");
      reveal("Teams run this check in CI against saved histories before every deploy.");
      await pause();

      say(bold("B) The same mistake, live."));
      say("Start a giftOrder with a 15-second pickup wait, on the old code…");
      await client.workflow.start("giftOrder", { taskQueue: TASK_QUEUE, workflowId: "gift-410b", args: [ORDER("gift-410b", { pickupSeconds: 15 })] });
      await waitFor("the charge", () => readLedger().some((e) => e.orderId === "gift-410b" && e.action === "charge"));
      say("…then 'deploy' the careless change while it's waiting:");
      await worker.kill();
      await worker.start({ WORKFLOWS: "workflows-changed" });
      await waitFor(
        "the non-determinism error",
        async () => {
          const out = tcli(["workflow", "show", "--workflow-id", "gift-410b"], { show: false });
          return out.includes("WorkflowTaskFailed");
        },
        40_000,
      );
      tcli(["workflow", "describe", "--workflow-id", "gift-410b"]);
      reveal("The timer fired, the new worker replayed the history, and the code no longer");
      reveal("matched: WorkflowTaskFailed with a non-determinism error. The workflow is stuck,");
      reveal("but nothing is lost.");
      await pause();

      say("Fix it the way you would in production: deploy the patched version.");
      await worker.kill();
      await worker.start({ WORKFLOWS: "workflows-patched" });
      await waitForWorkflow("gift-410b", ["COMPLETED"], 60_000);
      ledgerLine("gift-410b");
      good("The workflow recovered and finished, with no email (it started on the old code).");
    },
  },

  // -------------------------------------------------------------------------
  "4.11": {
    title: "Inspecting everything",
    async run() {
      const { client } = await boot();
      say("Generate some traffic: two good orders, a declined card, a waiting return.");
      await client.workflow.execute("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-a", args: [ORDER("order-a", { pickupSeconds: 1 })] });
      await client.workflow.execute("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-b", args: [ORDER("order-b", { pickupSeconds: 1 })] });
      setFault("bank.charge", { mode: "decline", times: 1 });
      await client.workflow.execute("checkout", { taskQueue: TASK_QUEUE, workflowId: "order-c", args: [ORDER("order-c")] }).catch(() => undefined);
      await client.workflow.start("returnRequest", { taskQueue: TASK_QUEUE, workflowId: "return-x", args: [{ orderId: "order-a", amountCents: 4999, reason: "changed mind" }] });
      await sleep(1500);

      say(bold("1. List everything"));
      tcli(["workflow", "list"]);
      say(bold("2. Filter with a visibility query"));
      tcli(["workflow", "list", "--query", "ExecutionStatus = 'Failed'"]);
      tcli(["workflow", "count", "--query", "WorkflowType = 'checkout'"]);
      say(bold("3. One workflow: summary, then full history"));
      tcli(["workflow", "describe", "--workflow-id", "order-c"]);
      tcli(["workflow", "show", "--workflow-id", "order-c"]);
      say(bold("4. Who is polling the task queue?"));
      tcli(["task-queue", "describe", "--task-queue", TASK_QUEUE]);
      say(bold("5. The Web UI"));
      say("Open http://localhost:8233: the same views, clickable, including a timeline of each");
      say("workflow's events. The server stays up until you press Enter.");
      await pause("Press Enter to stop the server…");
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
    await shutdownTemporal();
  }
  if (process.exitCode) break;
  if (ids.length > 1) await pause("Lesson done. Press Enter for the next one…");
}
console.log();
process.exit(process.exitCode ?? 0);
