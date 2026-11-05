/**
 * ENGINE v3: IDEMPOTENCY KEYS  (Lesson 2.5)
 *
 * The gap from Lesson 2.4 can't be closed by the engine alone: if the process
 * dies after the bank acted but before we journaled it, we will call the bank
 * again. What we CAN do is make the second call harmless.
 *
 * New idea: give every step a stable, unique key, the same on every retry and
 * every replay, and pass it to the outside system. A well-behaved API (most
 * payment APIs are) remembers keys it has seen and returns the original result
 * instead of acting twice.
 *
 * The key is simply "<workflowId>/<stepName>". It's stable because both parts
 * are stable.
 */
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export type StepInfo = { idempotencyKey: string };

export class Context {
  private journal;
  private position = 0;

  constructor(private file: string, private workflowId: string) {
    this.journal = loadJournal(file, workflowId);
  }

  get isCompleted() {
    return this.journal.status === "completed";
  }

  // NEW IN v3: the step function receives an idempotency key.
  async step<T>(name: string, fn: (info: StepInfo) => Promise<T>): Promise<T> {
    const recorded = this.journal.entries[this.position];
    if (recorded) {
      this.position++;
      log(`  ↺ replay  "${name}" → ${JSON.stringify(recorded.result)}  (from journal, NOT re-run)`);
      return recorded.result as T;
    }

    const idempotencyKey = `${this.workflowId}/${name}`;
    log(`  ▶ execute "${name}"  (idempotency key: ${idempotencyKey})`);
    const result = await fn({ idempotencyKey });

    maybeCrash("during", name);

    this.journal.entries.push({ step: name, result, completedAt: new Date().toISOString() });
    saveJournal(this.file, this.journal);
    this.position++;
    log(`  📝 journaled "${name}" → ${JSON.stringify(result)}`);

    maybeCrash("after", name);
    return result;
  }

  complete() {
    this.journal.status = "completed";
    saveJournal(this.file, this.journal);
  }
}

export async function runWorkflow(workflowId: string, workflow: (ctx: Context) => Promise<unknown>) {
  const ctx = new Context(journalPath("v3", workflowId), workflowId);
  if (ctx.isCompleted) return log(`  ✓ ${workflowId} already completed. Nothing to do.`);
  await workflow(ctx);
  ctx.complete();
}
