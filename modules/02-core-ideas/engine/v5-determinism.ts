/**
 * ENGINE v5: DETERMINISM  (Lesson 2.7)
 *
 * Replay only works if, on every run, the workflow code asks for the same
 * steps in the same order. The journal is matched to the code by position:
 * "entry 2 is the answer to the 2nd step the code asks for."
 *
 * Two things break that:
 *
 *   1. Decisions based on things that change between runs, like the clock or
 *      a random number, made OUTSIDE a step. On replay the decision can come
 *      out differently and the code takes a different path.
 *
 *   2. Changing the workflow code while a workflow is in flight (adding,
 *      removing or reordering steps), then letting it replay on the new code.
 *
 * New in v5:
 *   - the engine CHECKS that the step being asked for matches the journal, and
 *     stops with a NonDeterminismError if not (failing loudly beats silently
 *     returning the wrong result);
 *   - ctx.now() and ctx.random() turn the clock and randomness into journaled
 *     steps, so replay sees the same values.
 */
import { PermanentError } from "../../../shared/fake-world.js";
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export type StepInfo = { idempotencyKey: string; attempt: number };
export type RetryPolicy = { maxAttempts: number; initialDelayMs: number };

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, initialDelayMs: 200 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      // NEW IN v5: does the code still ask for the same step at this position?
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

  // NEW IN v5: deterministic versions of the clock and randomness.
  now(name = "now"): Promise<number> {
    return this.step(name, async () => Date.now());
  }
  random(name = "random"): Promise<number> {
    // FORCE_RANDOM lets a lesson choose which way the coin lands on a given run.
    return this.step(name, async () => (process.env.FORCE_RANDOM ? Number(process.env.FORCE_RANDOM) : Math.random()));
  }

  finish(status: "completed" | "failed", error?: string) {
    this.journal.status = status;
    if (error) this.journal.error = error;
    saveJournal(this.file, this.journal);
  }
}

export async function runWorkflow(workflowId: string, workflow: (ctx: Context) => Promise<unknown>) {
  const ctx = new Context(journalPath("v5", workflowId), workflowId);
  if (ctx.status !== "running") return log(`  ✓ ${workflowId} already ${ctx.status}. Nothing to do.`);
  try {
    await workflow(ctx);
    ctx.finish("completed");
  } catch (err) {
    if (err instanceof NonDeterminismError) {
      // Not marked failed: the journal is fine, the CODE is wrong. Fix the code
      // (or roll it back) and the workflow can carry on.
      log(`  🚨 NON-DETERMINISM: ${err.message}. Workflow paused, journal untouched.`);
      process.exitCode = 3;
      return;
    }
    if (!(err instanceof StepFailedError)) throw err;
    ctx.finish("failed", err.message);
    log(`  ❌ workflow ${workflowId} FAILED: ${err.message}`);
  }
}
