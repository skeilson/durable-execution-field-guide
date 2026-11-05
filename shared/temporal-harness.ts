/**
 * Starts and controls a local Temporal setup for the Module 4 lessons:
 *   - the Temporal dev server (port 7233; Web UI on 8233), via the Temporal CLI
 *   - one worker process, polling the "shop" task queue
 *
 * Unlike Restate, the Temporal server isn't installed by `npm install`: you
 * install the Temporal CLI once (lesson 4.2), and it includes the dev server.
 */
import { Client, Connection } from "@temporalio/client";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNTIME_DIR } from "./fake-world.js";
import { portOpen, waitFor } from "./restate-harness.js";
import { dim, sleep } from "./term.js";

const root = process.cwd();
export const TASK_QUEUE = "shop";

/** Find the `temporal` CLI on PATH, or where its installers usually put it. */
export function temporalBin(): string | undefined {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "temporal")),
    path.join(os.homedir(), ".temporalio", "bin", "temporal"),
    "/opt/homebrew/bin/temporal",
    "/usr/local/bin/temporal",
  ];
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const children: ChildProcess[] = [];
function killTree(c: ChildProcess) {
  if (c.pid === undefined || c.exitCode !== null || c.signalCode !== null) return;
  try {
    process.kill(-c.pid, "SIGKILL");
  } catch {
    c.kill("SIGKILL");
  }
}
function cleanup() {
  for (const c of children) killTree(c);
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

let client: Client | undefined;

/** Start a fresh, in-memory Temporal dev server. */
export async function startTemporal(): Promise<Client> {
  const bin = temporalBin();
  if (!bin) {
    throw new Error(
      "The Temporal CLI isn't installed. Follow lesson 4.2 (macOS: `brew install temporal`), then run this lesson again.",
    );
  }
  for (const p of [7233, 8233]) {
    for (let i = 0; i < 20 && (await portOpen(p)()); i++) await sleep(250);
    if (await portOpen(p)()) {
      throw new Error(`Port ${p} is already in use. Stop any other Temporal server (Ctrl+C in its terminal), then try again.`);
    }
  }
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const log = fs.openSync(path.join(RUNTIME_DIR, "temporal-server.log"), "w");
  const p = spawn(bin, ["server", "start-dev", "--ip", "127.0.0.1", "--ui-disable-news-fetch"], {
    cwd: root,
    stdio: ["ignore", log, log],
    detached: true,
  });
  children.push(p);
  await waitFor("the Temporal server", portOpen(7233), 60_000);

  // The port opens a moment before the "default" namespace is ready.
  const connection = await Connection.connect({ address: "localhost:7233" });
  client = new Client({ connection, namespace: "default" });
  await waitFor(
    "the default namespace",
    async () => {
      await client!.workflow.count();
      return true;
    },
    60_000,
  );
  return client;
}

export class Worker {
  private proc?: ChildProcess;
  constructor(private env: Record<string, string> = {}) {}

  /** Start the worker. Resolves once it has connected and is polling. */
  async start(env: Record<string, string> = {}) {
    const logFile = path.join(RUNTIME_DIR, "worker.log");
    const before = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    const log = fs.openSync(logFile, "a");
    this.proc = spawn(process.execPath, ["--import", "tsx", "modules/04-temporal/shop/worker.ts"], {
      cwd: root,
      stdio: ["ignore", log, log],
      env: { ...process.env, ...this.env, ...env },
      detached: true,
    });
    children.push(this.proc);
    const proc = this.proc;
    await waitFor(
      "the worker to start polling",
      () => {
        if (proc.exitCode !== null) throw new Error(`The worker exited early. See ${logFile}`);
        const text = fs.readFileSync(logFile, "utf8").slice(before);
        return text.includes("Worker polling");
      },
      90_000, // the first start bundles the workflow code, which takes a few seconds
    );
  }

  async kill() {
    if (this.proc) killTree(this.proc);
    await sleep(500);
  }
}

/** Run a Temporal CLI command and show it like a terminal session. */
export function tcli(args: string[], opts: { show?: boolean; allowFail?: boolean } = {}) {
  const show = opts.show ?? true;
  const shown = args.map((a) => (/[\s'"*()<>=]/.test(a) ? `'${a}'` : a)).join(" ");
  if (show) console.log(dim(`\n  $ temporal ${shown}\n`));
  const r = spawnSync(temporalBin()!, args, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (show) console.log(out.replace(/^/gm, "    ") + "\n");
  if (r.status !== 0 && !opts.allowFail) throw new Error(`temporal ${args.join(" ")} failed:\n${out}`);
  return out;
}

export function getClient(): Client {
  if (!client) throw new Error("Temporal isn't started");
  return client;
}

/** Wait until a workflow reaches one of the given statuses (RUNNING, COMPLETED, FAILED, …). */
export async function waitForWorkflow(workflowId: string, statuses: string[], timeoutMs = 30_000) {
  await waitFor(
    `workflow ${workflowId} to be ${statuses.join(" or ")}`,
    async () => statuses.includes((await getClient().workflow.getHandle(workflowId).describe()).status.name),
    timeoutMs,
  );
}

/** Stop everything and wait for the ports to close. */
export async function shutdownTemporal() {
  try {
    await client?.connection.close();
  } catch {
    /* already closed */
  }
  client = undefined;
  cleanup();
  for (const p of [7233, 8233]) await waitFor(`port ${p} to close`, async () => !(await portOpen(p)()), 15_000);
}
