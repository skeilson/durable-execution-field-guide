/**
 * Lesson 4.10: the same `giftOrder` workflow after a careless change.
 *
 * A developer added a confirmation email between reserving and charging, and
 * deployed it. Workflows that STARTED on the old code will replay their history
 * against this code, and their history says "after reserve comes charge", not
 * "after reserve comes an email". Temporal detects the mismatch and refuses to
 * continue: a non-determinism error.
 */
import { proxyActivities, sleep, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { Order } from "./workflows.js";

const acts = proxyActivities<typeof activities>({ startToCloseTimeout: "10 seconds" });

export async function giftOrder(order: Order) {
  await acts.reserveInventory(order.orderId, order.sku);
  await acts.sendEmail(order.orderId, "We're preparing your gift"); // NEW, unguarded
  await acts.chargeCard(order.orderId, order.amountCents);
  await sleep(`${order.pickupSeconds ?? 3} seconds`);
  await acts.shipOrder(order.orderId, order.address);
  return `${workflowInfo().workflowId} shipped`;
}
