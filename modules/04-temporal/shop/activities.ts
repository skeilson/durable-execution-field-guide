/**
 * Module 4: the shop's ACTIVITIES.
 *
 * In Temporal, every side effect lives in an activity: a plain async function
 * that the worker runs on the workflow's behalf. Activities can do anything:
 * call APIs, read files, talk to databases. Workflows can't, so they ask for
 * activities instead (see workflows.ts).
 *
 * These call the same fake bank, warehouse and carrier as Modules 1–3, so the
 * ledger tells you what really happened.
 */
import { activityInfo, log } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import fs from "node:fs";
import path from "node:path";
import { bank, email, inventory, PermanentError, RUNTIME_DIR, shipping } from "../../../shared/fake-world.js";

export async function composeGreeting(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

export async function reserveInventory(orderId: string, sku: string): Promise<string> {
  return inventory.reserve(orderId, sku);
}

export async function releaseInventory(orderId: string, sku: string): Promise<string> {
  return inventory.release(orderId, sku);
}

/**
 * Charge a card. Two details matter:
 *  - The idempotency key is built from the order id, which is the same on every
 *    retry, so a retry after a lost response is harmless.
 *  - A declined card is thrown as a NON-RETRYABLE ApplicationFailure, Temporal's
 *    equivalent of Restate's TerminalError. Any other error is retried.
 */
export async function chargeCard(orderId: string, amountCents: number): Promise<string> {
  const { attempt } = activityInfo();
  if (attempt > 1) log.info(`charge attempt ${attempt} for ${orderId}`);
  try {
    return await bank.charge(orderId, amountCents, { idempotencyKey: `${orderId}/charge` });
  } catch (err) {
    if (err instanceof PermanentError) throw ApplicationFailure.nonRetryable(`Card declined for ${orderId}`, "CardDeclined");
    throw err;
  }
}

export async function refund(orderId: string, amountCents: number): Promise<string> {
  return bank.refund(orderId, amountCents);
}

export async function shipOrder(orderId: string, address: string): Promise<string> {
  try {
    return await shipping.ship(orderId, address);
  } catch (err) {
    if (err instanceof PermanentError) {
      throw ApplicationFailure.nonRetryable(`Carrier rejected the address "${address}": not a deliverable address`, "AddressRejected");
    }
    throw err;
  }
}

export async function sendEmail(orderId: string, subject: string): Promise<void> {
  await email.send(orderId, subject);
}

/** Lesson 4.5: a supplier API that stays broken until the lesson "fixes" it. */
export async function supplierStockLevel(sku: string): Promise<number> {
  if (!fs.existsSync(path.join(RUNTIME_DIR, "supplier-fixed"))) {
    throw new Error("supplier API: 500 Internal Server Error");
  }
  return sku.length * 7;
}

/** Lesson 4.7: ask the payment provider to start a payment. It calls back later. */
export async function startProviderPayment(orderId: string, amountCents: number): Promise<void> {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  // The provider will need to know which workflow to notify: we pass the workflow id.
  const workflowId = activityInfo().workflowExecution?.workflowId;
  fs.appendFileSync(path.join(RUNTIME_DIR, "provider-inbox.jsonl"), JSON.stringify({ orderId, amountCents, workflowId }) + "\n");
}
