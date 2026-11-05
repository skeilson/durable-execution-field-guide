/**
 * ENGINE v6: DURABLE TIMERS  (Lesson 2.8)  — the complete mini engine
 *
 * Business processes wait: "send a reminder in 3 days", "cancel if unpaid
 * after 24 hours", "wait for warehouse pickup". An ordinary `setTimeout` lives
 * in memory, so a crash forgets it. Restart, and the wait starts over (or
 * never happens).
 *
 * New idea: a timer is just another journaled step. The first time through,
 * journal WHEN to wake up (not how long to wait). On replay, wait only for
 * whatever time is left. If the wake-up time has already passed, continue
 * immediately.
 *
 * This is everything from v1–v5 plus ctx.sleep(). Real engines go one step
 * further: while a workflow sleeps, nothing needs to stay running at all.
 * The server remembers the timer and wakes the code up when it's due.
 */
import { PermanentError } from "../../../shared/fake-world.js";
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export type StepInfo = { idempotencyKey: string; attempt: number };
export type RetryPolicy = { maxAttempts: number; initialDelayMs: number };

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, initialDelayMs: 200 };
const realSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class StepFailedError extends Error {}
export class NonDeterminismError extends Error {}

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
      if (recorded.step !== name) {
        throw new NonDeterminismError(
          `journal entry #${this.position} is "${recorded.step}", but the code now asks for "${name}"`,
        );
      }
      this.position++;
      log(`  ↺ replay  "${name}" → ${JSON.stringify(recorded.result)}  (from journal, NOT re-run)`);
      return recorded.result as T;
    }

    const idempotencyKey = `${this.workflowId}/${name}`;
    let result: T;
    for (let attempt = 1; ; attempt++) {
      log(`  ▶ execute "${name}"${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      try {
        result = await fn({ idempotencyKey, attempt });
        break;
      } catch (err) {
        const message = (err as Error).message;
        if (err instanceof PermanentError || attempt >= retry.maxAttempts) {
          log(`  ⛔ "${name}" failed: ${message}`);
          throw new StepFailedError(`${name}: ${message}`);
        }
        const delay = retry.initialDelayMs * 2 ** (attempt - 1);
        log(`  ⚠ "${name}" failed: ${message}. Retrying in ${delay}ms…`);
        await realSleep(delay);
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

  now(name = "now"): Promise<number> {
    return this.step(name, async () => Date.now());
  }
  random(name = "random"): Promise<number> {
    // FORCE_RANDOM lets a lesson choose which way the coin lands on a given run.
    return this.step(name, async () => (process.env.FORCE_RANDOM ? Number(process.env.FORCE_RANDOM) : Math.random()));
  }

  // NEW IN v6: a durable timer.
  async sleep(name: string, ms: number): Promise<void> {
    // Journal the wake-up TIME as a step, so replay gets the same deadline.
    const wakeAt = await this.step(`timer: ${name}`, async () => Date.now() + ms);
    const remaining = wakeAt - Date.now();
    if (remaining > 0) {
      log(`  ⏳ sleeping "${name}": ${(remaining / 1000).toFixed(1)}s left (wake at ${new Date(wakeAt).toLocaleTimeString()})`);
      // Give lessons a moment to crash us mid-sleep.
      if (process.env.CRASH === `during-sleep:${name}`) {
        await realSleep(Math.min(remaining, 1500));
        log(`  💥 CRASH while sleeping "${name}" (the process dies here)`);
        process.exit(137);
      }
      await realSleep(remaining);
    } else {
      log(`  ⏰ timer "${name}" already due, continuing immediately`);
    }
  }

  finish(status: "completed" | "failed", error?: string) {
    this.journal.status = status;
    if (error) this.journal.error = error;
    saveJournal(this.file, this.journal);
  }
}

export async function runWorkflow(workflowId: string, workflow: (ctx: Context) => Promise<unknown>) {
  const ctx = new Context(journalPath("v6", workflowId), workflowId);
  if (ctx.status !== "running") return log(`  ✓ ${workflowId} already ${ctx.status}. Nothing to do.`);
  try {
    await workflow(ctx);
    ctx.finish("completed");
  } catch (err) {
    if (err instanceof NonDeterminismError) {
      log(`  🚨 NON-DETERMINISM: ${err.message}. Workflow paused, journal untouched.`);
      process.exitCode = 3;
      return;
    }
    if (!(err instanceof StepFailedError)) throw err;
    ctx.finish("failed", err.message);
    log(`  ❌ workflow ${workflowId} FAILED: ${err.message}`);
  }
}
