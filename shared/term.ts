/** Small helpers for readable, narrated, interactive demo output. */
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";

const color = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = color(1);
export const dim = color(2);
export const red = color(31);
export const green = color(32);
export const yellow = color(33);
export const blue = color(34);
export const magenta = color(35);
export const cyan = color(36);

export function heading(text: string) {
  console.log("\n" + bold(cyan("━".repeat(72))));
  console.log(bold(cyan(text)));
  console.log(bold(cyan("━".repeat(72))));
}

export function say(text: string) {
  console.log(yellow("» ") + text);
}

export function good(text: string) {
  console.log(green("  ✔ " + text));
}

export function bad(text: string) {
  console.log(red("  ✘ " + text));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when nobody is at the keyboard (CI, piped output). Prompts are skipped. */
export const nonInteractive = !process.stdin.isTTY || !!process.env.CI;

/** Wait for Enter so the learner can read before moving on. */
export async function pause(message = "Press Enter to continue…") {
  if (nonInteractive) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(dim(`\n  ${message} `));
  rl.close();
}

/**
 * Ask the learner to predict an outcome before showing it.
 * Predicting first is what turns a demo into learning.
 */
export async function predict(question: string, options: string[]) {
  console.log("\n" + bold(magenta("🤔 Predict: ")) + bold(question));
  options.forEach((o, i) => console.log(magenta(`   ${String.fromCharCode(97 + i)}) `) + o));
  if (nonInteractive) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(dim("   Make your guess, then press Enter to find out… "));
  rl.close();
}

/** Reveal the answer to a prediction. */
export function reveal(text: string) {
  console.log(bold(magenta("💡 ")) + text);
}

/**
 * An error's message plus the chain of causes beneath it. Temporal in
 * particular wraps the real reason ("Workflow Update failed" → why).
 */
export function explainError(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e && depth < 6; depth++) {
    const msg = (e as Error).message ?? String(e);
    if (msg && !parts.includes(msg)) parts.push(msg);
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join("\n  caused by: ");
}

/** Run a TypeScript file as a separate Node process, so a crash really kills a process. */
export function runTs(file: string, args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, ["--import", "tsx", file, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return res.status ?? 1;
}
