/**
 * Lesson 4.10: the same change, made safely with `patched`.
 *
 * `patched("gift-email")` answers one question: "is this execution new enough to
 * run the new code?"
 *   - On a workflow that started BEFORE the change, during replay it returns
 *     false, so the old path runs and the history still lines up.
 *   - On a workflow that starts AFTER the change, it returns true and records a
 *     marker in the history, so later replays also take the new path.
 *
 * Once no old executions remain, the patch can be cleaned up with
 * deprecatePatch(), and later removed entirely.
 */
import { patched, proxyActivities, sleep, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { Order } from "./workflows.js";

const acts = proxyActivities<typeof activities>({ startToCloseTimeout: "10 seconds" });

export async function giftOrder(order: Order) {
  await acts.reserveInventory(order.orderId, order.sku);
  if (patched("gift-email")) {
    await acts.sendEmail(order.orderId, "We're preparing your gift");
  }
  await acts.chargeCard(order.orderId, order.amountCents);
  await sleep(`${order.pickupSeconds ?? 3} seconds`);
  await acts.shipOrder(order.orderId, order.address);
  return `${workflowInfo().workflowId} shipped`;
}
