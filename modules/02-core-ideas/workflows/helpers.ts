/** Helpers the Module 2 lesson scripts share. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countFor } from "../../../shared/fake-world.js";
import { bad, dim, good, runTs } from "../../../shared/term.js";
import { journalPath, type Journal } from "../engine/shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(here, "run.ts");

/** Run the order workflow on an engine version, in a separate process. */
export function run(version: string, orderId: string, opts: { crash?: string; variant?: string; env?: Record<string, string> } = {}) {
  const env: Record<string, string> = { ...opts.env };
  if (opts.crash) env.CRASH = opts.crash;
  return runTs(RUN, [version, orderId, opts.variant ?? ""], env);
}

/** Print a journal file the way a person would want to read it. */
export function showJournal(version: string, orderId: string) {
  const file = journalPath(version, orderId);
  if (!fs.existsSync(file)) return console.log(dim("  (no journal yet)"));
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as Journal;
  console.log(dim(`\n  ┌─ journal: ${path.relative(process.cwd(), file)}`));
  console.log(dim(`  │  status: ${j.status}${j.error ? ` (${j.error})` : ""}`));
  j.entries.forEach((e, i) => console.log(dim(`  │  #${i}  ${e.step.padEnd(24)} → ${JSON.stringify(e.result)}`)));
  if (j.entries.length === 0) console.log(dim("  │  (empty)"));
  console.log(dim("  └─\n"));
}

/** Check the outside world: how many times did each thing really happen? */
export function ledger(orderId: string) {
  const charged = countFor(orderId, "bank", "charge");
  const deduped = countFor(orderId, "bank", "charge-deduplicated");
  const shipped = countFor(orderId, "shipping", "ship");
  let line = `Ledger for ${orderId}: charged ${charged}×, shipped ${shipped}×`;
  if (deduped) line += `  (bank ignored ${deduped} duplicate request${deduped > 1 ? "s" : ""})`;
  if (charged === 1 && shipped === 1) good(line);
  else bad(line);
  return { charged, shipped, deduped };
}
