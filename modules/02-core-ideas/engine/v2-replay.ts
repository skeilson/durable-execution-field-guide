/**
 * ENGINE v2: REPLAY  (Lessons 2.3 and 2.4)
 *
 * New idea: after a crash, run the workflow again from the top, but for each
 * step that's already in the journal, hand back the recorded result instead
 * of doing the work again.
 *
 * The workflow code doesn't change at all. It still reads top to bottom. The
 * engine quietly fast-forwards through the steps that already happened.
 */
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export class Context {
  private journal;
  private position = 0; // NEW: how far through the journal this run has gotten

  constructor(private file: string, workflowId: string) {
    this.journal = loadJournal(file, workflowId); // NEW: keep what earlier runs recorded
  }

  get isCompleted() {
    return this.journal.status === "completed";
  }

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    // NEW IN v2: is this step already in the journal?
    const recorded = this.journal.entries[this.position];
    if (recorded) {
      this.position++;
      log(`  ↺ replay  "${name}" → ${JSON.stringify(recorded.result)}  (from journal, NOT re-run)`);
      return recorded.result as T;
    }

    log(`  ▶ execute "${name}"`);
    const result = await fn();

    // ⚠ THE GAP (Lesson 2.4): if the process dies right here, the side effect
    // has happened but isn't journaled. On restart this step runs again.
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
  const ctx = new Context(journalPath("v2", workflowId), workflowId);
  if (ctx.isCompleted) return log(`  ✓ ${workflowId} already completed. Nothing to do.`);
  await workflow(ctx);
  ctx.complete();
}
