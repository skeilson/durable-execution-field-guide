/**
 * Module 4: the shop's WORKFLOWS.
 *
 * Workflow code is the orchestration: which steps, in what order, with what
 * waiting in between. Temporal runs it in a sandbox and REPLAYS it from the
 * event history after any crash, so it must be deterministic (lesson 2.7):
 *
 *   - No direct I/O (network, files, databases). Ask for an activity instead.
 *   - Time and randomness are safe: inside the sandbox, Date.now() and
 *     Math.random() are replaced with replay-safe versions.
 *   - `sleep` and `condition` from @temporalio/workflow are durable timers.
 *
 * Notice the import below is `import type`: workflows never load activity
 * code, they only know the activities' names and signatures.
 */
import {
  ApplicationFailure,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  defineUpdate,
  allHandlersFinished,
  executeChild,
  log,
  proxyActivities,
  setHandler,
  sleep,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";

export type Order = { orderId: string; sku: string; amountCents: number; address: string; pickupSeconds?: number };

/**
 * How activities are run: each attempt may take up to 10s; failed attempts are
 * retried starting at 500ms, doubling, up to 10s between attempts. Temporal's
 * default is to retry forever unless a maximum is set.
 */
const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { initialInterval: "500 milliseconds", backoffCoefficient: 2, maximumInterval: "10 seconds" },
});

// ---------------------------------------------------------------------------
// 4.3  Hello world
// ---------------------------------------------------------------------------
export async function greet(name: string): Promise<string> {
  return acts.composeGreeting(name);
}

// ---------------------------------------------------------------------------
// 4.3–4.6  Checkout: the same process as Restate's Orders/checkout
// ---------------------------------------------------------------------------
export async function checkout(order: Order) {
  const reservation = await acts.reserveInventory(order.orderId, order.sku);
  const payment = await acts.chargeCard(order.orderId, order.amountCents);
  await acts.sendEmail(order.orderId, "Thanks for your order");

  await sleep(`${order.pickupSeconds ?? 5} seconds`); // a durable timer

  const tracking = await acts.shipOrder(order.orderId, order.address);
  return { orderId: order.orderId, reservation, payment, tracking };
}

// ---------------------------------------------------------------------------
// 4.5  A retry limit: what happens when attempts run out
// ---------------------------------------------------------------------------
const limited = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 seconds",
  retry: { initialInterval: "300 milliseconds", backoffCoefficient: 2, maximumAttempts: 4 },
});

export async function inventorySync(sku: string): Promise<string> {
  const level = await limited.supplierStockLevel(sku);
  return `${sku}: ${level} in stock`;
}

// ---------------------------------------------------------------------------
// 4.6  Timers: a reminder
// ---------------------------------------------------------------------------
export async function reminder(orderId: string, inSeconds: number): Promise<string> {
  await sleep(`${inSeconds} seconds`);
  await acts.sendEmail(orderId, "Your cart misses you");
  return "reminded";
}

// ---------------------------------------------------------------------------
// 4.7  Signals, queries and updates: a cart as a long-running "entity" workflow
// ---------------------------------------------------------------------------
export type CartItem = { sku: string; priceCents: number };
export const addItem = defineSignal<[CartItem]>("addItem");
export const viewCart = defineQuery<{ items: CartItem[]; totalCents: number }>("viewCart");
export const checkoutCart = defineUpdate<string, [string]>("checkoutCart");

/**
 * One workflow per customer (workflow id "cart-<customer>"), running for as
 * long as the cart exists. Signals add items, queries read the cart, and an
 * update checks out and returns the new order id.
 *
 * Temporal has no built-in per-key state like Restate's virtual objects; this
 * "entity workflow" pattern is the usual equivalent. Each event adds to the
 * history, so after many events the workflow continues as new with its current
 * state, starting a fresh, short history (lesson 4.8).
 */
export async function cart(customer: string, items: CartItem[] = []): Promise<string> {
  let orderId: string | undefined;
  let checkedOut = false; // set only once checkout has fully finished
  let events = 0;

  setHandler(addItem, (item) => {
    items.push(item);
    events++;
  });
  setHandler(viewCart, () => ({ items, totalCents: items.reduce((n, i) => n + i.priceCents, 0) }));
  setHandler(
    checkoutCart,
    async (address) => {
      const id = `${customer}-${uuid4().slice(0, 8)}`; // uuid4 from @temporalio/workflow is replay-safe
      await acts.reserveInventory(id, items.map((i) => i.sku).join("+"));
      orderId = id;
      checkedOut = true;
      return id;
    },
    {
      // Validators run before the update is accepted. Rejecting here means the
      // update leaves no trace in the history.
      validator: (address: string) => {
        if (items.length === 0) throw new Error("Cart is empty");
        if (!address) throw new Error("Address is required");
      },
    },
  );

  // Wait until checkout has FINISHED, or until the history is getting long.
  // (Waiting for "checkout started" instead would let the workflow end while
  // the checkout update was still running, and Temporal would fail the update.)
  await condition(() => checkedOut || events >= 100);
  // Never end, or continue as new, with a message handler still in progress.
  await condition(allHandlersFinished);
  if (!checkedOut) {
    log.info(`cart ${customer}: continuing as new with ${items.length} items`);
    await continueAsNew<typeof cart>(customer, items);
  }
  return orderId!;
}

// ---------------------------------------------------------------------------
// 4.7  A return that waits for a human: signal + query
// ---------------------------------------------------------------------------
export type Decision = { approved: boolean; by: string };
export const decide = defineSignal<[Decision]>("decide");
export const returnStatus = defineQuery<string>("status");

export async function returnRequest(req: { orderId: string; amountCents: number; reason: string }) {
  let decision: Decision | undefined;
  let status = "waiting for approval";
  setHandler(decide, (d) => void (decision = d));
  setHandler(returnStatus, () => status);

  // Wait up to 7 days for a decision. `condition` is a durable wait.
  const decided = await condition(() => decision !== undefined, "7 days");
  if (!decided) {
    status = "expired";
    return { refunded: false };
  }
  if (!decision!.approved) {
    status = `rejected by ${decision!.by}`;
    return { refunded: false };
  }
  status = `approved by ${decision!.by}, refunding`;
  await acts.refund(req.orderId, req.amountCents);
  status = "refunded";
  return { refunded: true };
}

// ---------------------------------------------------------------------------
// 4.7  Waiting for a webhook: the provider's callback arrives as a signal
// ---------------------------------------------------------------------------
export type PaymentResult = { status: "paid" | "failed"; providerRef: string };
export const paymentResult = defineSignal<[PaymentResult]>("paymentResult");

export async function asyncPayment(req: { orderId: string; amountCents: number }) {
  let result: PaymentResult | undefined;
  setHandler(paymentResult, (r) => void (result = r));
  await acts.startProviderPayment(req.orderId, req.amountCents);
  await condition(() => result !== undefined);
  return { orderId: req.orderId, ...result! };
}

// ---------------------------------------------------------------------------
// 4.9  Saga: undo completed steps when a later one fails for good
// ---------------------------------------------------------------------------
export async function orderSaga(order: Order) {
  const compensations: Array<() => Promise<unknown>> = [];
  try {
    await acts.reserveInventory(order.orderId, order.sku);
    compensations.push(() => acts.releaseInventory(order.orderId, order.sku));

    await acts.chargeCard(order.orderId, order.amountCents);
    compensations.push(() => acts.refund(order.orderId, order.amountCents));

    await acts.shipOrder(order.orderId, order.address);
    return { orderId: order.orderId, status: "shipped" };
  } catch (err) {
    log.warn(`order ${order.orderId} failed, undoing ${compensations.length} step(s)`);
    for (const undo of compensations.reverse()) await undo();
    throw ApplicationFailure.nonRetryable(`Order ${order.orderId} failed and was rolled back`, "OrderFailed");
  }
}

// ---------------------------------------------------------------------------
// 4.10  A workflow we'll change under a running execution
// ---------------------------------------------------------------------------
export async function giftOrder(order: Order) {
  await acts.reserveInventory(order.orderId, order.sku);
  await acts.chargeCard(order.orderId, order.amountCents);
  await sleep(`${order.pickupSeconds ?? 3} seconds`);
  await acts.shipOrder(order.orderId, order.address);
  return `${workflowInfo().workflowId} shipped`;
}

// ---------------------------------------------------------------------------
// 4.5  A bug in WORKFLOW code (not an activity)
// ---------------------------------------------------------------------------
/**
 * This workflow has a bug: it assumes every order has a gift message.
 * An ordinary error thrown from workflow code (a TypeError here) doesn't fail
 * the workflow. Temporal treats it as a failed WORKFLOW TASK and retries it,
 * so the workflow stays "Running" until someone deploys a fix, then picks up
 * where it left off. That's deliberate: a bug shouldn't destroy work.
 */
export async function printLabel(order: Order & { giftMessage?: string }) {
  await acts.reserveInventory(order.orderId, order.sku);
  const label = order.giftMessage!.toUpperCase(); // 💥 TypeError when there's no gift message
  return `${order.orderId}: ${label}`;
}

// ---------------------------------------------------------------------------
// 4.8  Child workflows: one parent starts many children
// ---------------------------------------------------------------------------
export async function batchCheckout(orders: Order[]) {
  // Each order gets its own child workflow, with its own id and history.
  // The parent waits for all of them.
  const results = await Promise.allSettled(
    orders.map((o) => executeChild(checkout, { workflowId: `batch-${o.orderId}`, args: [o] })),
  );
  return results.map((r, i) => `${orders[i].orderId}: ${r.status === "fulfilled" ? "shipped" : "failed"}`);
}
