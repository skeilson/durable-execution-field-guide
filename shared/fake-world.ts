/**
 * The "outside world" every lesson talks to: a warehouse, a bank, and a
 * shipping carrier.
 *
 * Real systems would call Stripe, a warehouse API, a shipping carrier, and so
 * on. Here each one is faked by appending a line to a ledger file. The ledger
 * is the ground truth for every demo: if a customer was charged twice, the
 * ledger shows two "charge" lines for the same order, no matter what the
 * workflow engine claims.
 *
 * Lessons can make these systems misbehave on purpose (fail, hang, lose
 * their response) by writing a faults file. See `setFault` below.
 *
 * Support habit to build: don't trust the orchestrator's view alone, check
 * the system of record.
 */
import fs from "node:fs";
import path from "node:path";

export const RUNTIME_DIR = path.resolve(process.cwd(), ".runtime");
export const LEDGER_FILE = path.join(RUNTIME_DIR, "ledger.jsonl");
const FAULTS_FILE = path.join(RUNTIME_DIR, "faults.json");

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type System = "inventory" | "bank" | "shipping" | "email";

export type LedgerEntry = {
  at: string;
  system: System;
  action: string;
  orderId: string;
  detail: string;
  idempotencyKey?: string;
};

function record(entry: Omit<LedgerEntry, "at">): LedgerEntry {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const full = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(LEDGER_FILE, JSON.stringify(full) + "\n");
  return full;
}

export function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  return fs
    .readFileSync(LEDGER_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEntry);
}

/** Count real side effects for an order. Rejected duplicates don't count. */
export function countFor(orderId: string, system: System, action?: string): number {
  return readLedger().filter(
    (e) =>
      e.orderId === orderId &&
      e.system === system &&
      (action ? e.action === action : !e.action.endsWith("-deduplicated")),
  ).length;
}

export function clearLedger() {
  fs.rmSync(LEDGER_FILE, { force: true });
}

// ---------------------------------------------------------------------------
// Fault injection
// ---------------------------------------------------------------------------

/**
 * How an outside system should misbehave on its next call(s):
 *
 *   error         fails before doing anything, like a 503 (safe to retry)
 *   lost-response does the work, then the reply is lost: the caller sees a
 *                 timeout but the side effect DID happen (the dangerous one)
 *   decline       fails permanently, like "card declined" (retrying won't help)
 *   hang          takes `delayMs` before responding
 */
export type FaultMode = "error" | "lost-response" | "decline" | "hang";
export type Fault = { mode: FaultMode; times: number; delayMs?: number };
type FaultTarget = "inventory.reserve" | "bank.charge" | "bank.refund" | "shipping.ship";

function readFaults(): Partial<Record<FaultTarget, Fault>> {
  try {
    return JSON.parse(fs.readFileSync(FAULTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function setFault(target: FaultTarget, fault: Fault) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(FAULTS_FILE, JSON.stringify({ ...readFaults(), [target]: fault }, null, 2));
}

export function clearFaults() {
  fs.rmSync(FAULTS_FILE, { force: true });
}

/** Take one fault off the counter for this target, if any is armed. */
function takeFault(target: FaultTarget): Fault | undefined {
  const faults = readFaults();
  const f = faults[target];
  if (!f || f.times <= 0) return undefined;
  faults[target] = { ...f, times: f.times - 1 };
  fs.writeFileSync(FAULTS_FILE, JSON.stringify(faults, null, 2));
  return f;
}

/** A failure that is worth retrying (network blip, 503, timeout). */
export class TransientError extends Error {
  readonly transient = true;
}
/** A failure that retrying will never fix (card declined, invalid address). */
export class PermanentError extends Error {
  readonly permanent = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a side effect with whatever fault is armed for it.
 * `act` performs the side effect and returns its result.
 */
async function withFaults<T>(target: FaultTarget, act: () => T): Promise<T> {
  await sleep(200); // every outside call takes a little time
  const fault = takeFault(target);
  switch (fault?.mode) {
    case "error":
      throw new TransientError(`${target}: 503 Service Unavailable`);
    case "decline":
      throw new PermanentError(`${target}: declined`);
    case "hang":
      await sleep(fault.delayMs ?? 5000);
      return act();
    case "lost-response":
      act(); // the work happens...
      throw new TransientError(`${target}: timed out waiting for response`); // ...but we never hear back
    default:
      return act();
  }
}

// ---------------------------------------------------------------------------
// The systems
// ---------------------------------------------------------------------------

export const inventory = {
  reserve(orderId: string, sku: string): Promise<string> {
    return withFaults("inventory.reserve", () => {
      record({ system: "inventory", action: "reserve", orderId, detail: sku });
      return `res_${orderId}`;
    });
  },
  release(orderId: string, sku: string): Promise<string> {
    return withFaults("inventory.reserve", () => {
      record({ system: "inventory", action: "release", orderId, detail: sku });
      return `rel_${orderId}`;
    });
  },
};

export const bank = {
  /**
   * Charge a card. If `idempotencyKey` is given and the bank has already seen
   * it, the bank returns the original result instead of charging again. This
   * is how real payment APIs (Stripe, Adyen, ...) protect against retries.
   */
  charge(orderId: string, amountCents: number, opts: { idempotencyKey?: string } = {}): Promise<string> {
    return withFaults("bank.charge", () => {
      const key = opts.idempotencyKey;
      if (key && readLedger().some((e) => e.system === "bank" && e.action === "charge" && e.idempotencyKey === key)) {
        record({ system: "bank", action: "charge-deduplicated", orderId, detail: "duplicate ignored", idempotencyKey: key });
        return `pay_${orderId}`;
      }
      record({
        system: "bank",
        action: "charge",
        orderId,
        detail: `$${(amountCents / 100).toFixed(2)}`,
        ...(key ? { idempotencyKey: key } : {}),
      });
      return `pay_${orderId}`;
    });
  },
  refund(orderId: string, amountCents: number): Promise<string> {
    return withFaults("bank.refund", () => {
      record({ system: "bank", action: "refund", orderId, detail: `$${(amountCents / 100).toFixed(2)}` });
      return `ref_${orderId}`;
    });
  },
};

/** The carrier's address check: a deliverable address has a street number. */
export function isDeliverable(address: string): boolean {
  return /\d/.test(address);
}

export const shipping = {
  /**
   * Ship an order. The carrier really checks the address: one with no street
   * number (like "Nowhere") is rejected for good, because retrying won't make
   * it deliverable.
   */
  ship(orderId: string, address: string): Promise<string> {
    return withFaults("shipping.ship", () => {
      if (!isDeliverable(address)) {
        throw new PermanentError(`shipping.ship: address not found: "${address}" (no street number)`);
      }
      record({ system: "shipping", action: "ship", orderId, detail: address });
      return `trk_${orderId}`;
    });
  },
};

export const email = {
  async send(orderId: string, subject: string): Promise<void> {
    await sleep(100);
    record({ system: "email", action: "send", orderId, detail: subject });
  },
};
