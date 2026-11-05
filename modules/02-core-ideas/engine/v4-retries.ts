/**
 * ENGINE v4: RETRIES AND PERMANENT FAILURES  (Lesson 2.6)
 *
 * New idea: when a step fails, the engine decides whether to try again.
 *
 *   Transient failure (503, timeout, network blip) → wait, then retry, waiting
 *   a little longer each time ("exponential backoff").
 *
 *   Permanent failure (card declined, invalid address) → stop immediately.
 *   Retrying can't fix it, and hammering the other system makes things worse.
 *
 * Retries are only safe because of v3: every retry of a step reuses the same
 * idempotency key, so a retry after a lost response is harmless.
 */
import { PermanentError } from "../../../shared/fake-world.js";
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export type StepInfo = { idempotencyKey: string; attempt: number };
export type RetryPolicy = { maxAttempts: number; initialDelayMs: number };

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, initialDelayMs: 200 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thrown when a step fails for good. The workflow stops and is marked failed. */
export class StepFailedError extends Error {}

export class Context {
  private journal;
  private position = 0;

  constructor(private file: string, private workflowId: string) {
    this.journal = loadJournal(file, workflowId);
  }

  get status() {
    return this.journal.status;
  }

  async step<T>(name: string, fn: (info: StepInfo) => Promise<T>, retry: RetryPolicy = DEFAULT_RETRY): Promise<T> {
    const recorded = this.journal.entries[this.position];
    if (recorded) {
      this.position++;
      log(`  ↺ replay  "${name}" → ${JSON.stringify(recorded.result)}  (from journal, NOT re-run)`);
      return recorded.result as T;
    }

    const idempotencyKey = `${this.workflowId}/${name}`;

    // NEW IN v4: the retry loop.
    let result: T;
    for (let attempt = 1; ; attempt++) {
      log(`  ▶ execute "${name}" (attempt ${attempt}/${retry.maxAttempts})`);
      try {
        result = await fn({ idempotencyKey, attempt });
        break;
      } catch (err) {
        const message = (err as Error).message;
        if (err instanceof PermanentError) {
          log(`  ⛔ "${name}" failed permanently: ${message}. Not retrying.`);
          throw new StepFailedError(`${name}: ${message}`);
        }
        if (attempt >= retry.maxAttempts) {
          log(`  ⛔ "${name}" still failing after ${attempt} attempts: ${message}. Giving up.`);
          throw new StepFailedError(`${name}: ${message}`);
        }
        const delay = retry.initialDelayMs * 2 ** (attempt - 1); // 200, 400, 800, ...
        log(`  ⚠ "${name}" failed: ${message}. Retrying in ${delay}ms…`);
        await sleep(delay);
      }
    }

    maybeCrash("during", name);
    this.journal.entries.push({ step: name, result, completedAt: new Date().toISOString() });
    saveJournal(this.file, this.journal);
    this.position++;
    log(`  📝 journaled "${name}" → ${JSON.stringify(result)}`);
    maybeCrash("after", name);
    return result;
  }

  finish(status: "completed" | "failed", error?: string) {
    this.journal.status = status;
    if (error) this.journal.error = error;
    saveJournal(this.file, this.journal);
  }
}

export async function runWorkflow(workflowId: string, workflow: (ctx: Context) => Promise<unknown>) {
  const ctx = new Context(journalPath("v4", workflowId), workflowId);
  if (ctx.status !== "running") return log(`  ✓ ${workflowId} already ${ctx.status}. Nothing to do.`);
  try {
    await workflow(ctx);
    ctx.finish("completed");
  } catch (err) {
    if (!(err instanceof StepFailedError)) throw err;
    ctx.finish("failed", err.message);
    log(`  ❌ workflow ${workflowId} FAILED: ${err.message}`);
  }
}
