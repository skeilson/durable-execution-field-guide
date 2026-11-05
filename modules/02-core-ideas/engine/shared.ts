/**
 * Pieces every engine version shares: where journals live, how they're saved,
 * and the crash switch the lessons use.
 */
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../../../shared/fake-world.js";

export type JournalEntry = {
  step: string;
  result: unknown;
  completedAt: string;
};

export type Journal = {
  workflowId: string;
  status: "running" | "completed" | "failed";
  entries: JournalEntry[];
  error?: string;
};

export function journalPath(version: string, workflowId: string) {
  return path.join(RUNTIME_DIR, "journals", version, `${workflowId}.json`);
}

export function loadJournal(file: string, workflowId: string): Journal {
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Journal)
    : { workflowId, status: "running", entries: [] };
}

/** Write to a temp file, then rename. A crash mid-write can't leave half a journal. */
export function saveJournal(file: string, journal: Journal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(journal, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * The lessons crash the process on purpose. Set CRASH to:
 *   after:<step>   right after <step> is saved to the journal
 *   during:<step>  after <step>'s side effect happened, before it's journaled
 */
export function maybeCrash(when: "during" | "after", step: string) {
  if (process.env.CRASH === `${when}:${step}`) {
    console.log(`  💥 CRASH ${when} "${step}" (the process dies here)`);
    process.exit(137);
  }
}

export const log = (msg: string) => console.log(msg);
