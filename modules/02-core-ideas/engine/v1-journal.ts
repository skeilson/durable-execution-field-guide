/**
 * ENGINE v1: THE JOURNAL  (Lesson 2.2)
 *
 * One new idea: every time a step finishes, write down its result.
 *
 * That's all this version does. It doesn't use the journal for anything yet,
 * so a crash still means starting over. But it creates the record that every
 * later version builds on.
 */
import { journalPath, loadJournal, log, maybeCrash, saveJournal } from "./shared.js";

export class Context {
  private journal;

  constructor(private file: string, workflowId: string) {
    this.journal = loadJournal(file, workflowId);
    // v1 ignores anything already in the journal and starts a fresh list.
    this.journal.entries = [];
    saveJournal(this.file, this.journal);
  }

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    log(`  ▶ execute "${name}"`);
    const result = await fn();

    // NEW IN v1: write the result down before moving on.
    this.journal.entries.push({ step: name, result, completedAt: new Date().toISOString() });
    saveJournal(this.file, this.journal);
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
  const ctx = new Context(journalPath("v1", workflowId), workflowId);
  await workflow(ctx);
  ctx.complete();
}
