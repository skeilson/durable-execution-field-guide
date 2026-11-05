/**
 * Starts and controls a local Restate setup for the lessons:
 *   - the Restate server (ports 8080 for requests, 9070 for admin and the UI)
 *   - one service process (port 9080)
 *
 * Lessons use it so they can crash and restart things on cue. When you follow
 * a lesson by hand, you do the same things in separate terminals instead.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { RUNTIME_DIR } from "./fake-world.js";
import { dim, sleep } from "./term.js";

const root = process.cwd();
const bin = (name: string) => path.join(root, "node_modules", ".bin", name);
export const INGRESS = "http://localhost:8080";
export const ADMIN = "http://localhost:9070";

const children: ChildProcess[] = [];
/**
 * Kill a child and everything it started. Each child runs in its own process
 * group (spawned with `detached`), because `restate-server` in node_modules is
 * a small launcher that starts the real server as its own child.
 */
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

export async function waitFor(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return;
    } catch {
      /* not ready yet */
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}. Try "npm run reset" and run the lesson again.`);
}

/** Services speak HTTP/2, so check that the port accepts connections instead of using fetch. */
export const portOpen = (port: number) => () =>
  new Promise<boolean>((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });

/** Start a fresh Restate server with no leftover data. */
export async function startServer() {
  for (const p of [8080, 9070, 9080]) {
    // A previous lesson's processes may still be shutting down: give them a moment.
    for (let i = 0; i < 20 && (await portOpen(p)()); i++) await sleep(250);
    if (await portOpen(p)()) {
      throw new Error(
        `Port ${p} is already in use. Stop any other Restate server or service (Ctrl+C in its terminal), then run the lesson again.`,
      );
    }
  }
  fs.rmSync(path.join(root, ".restate-data"), { recursive: true, force: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const log = fs.openSync(path.join(RUNTIME_DIR, "restate-server.log"), "w");
  const p = spawn(bin("restate-server"), ["--base-dir", ".restate-data", "--bind-ip", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", log, log],
    detached: true,
  });
  children.push(p);
  await waitFor("the Restate server", async () => (await fetch(`${ADMIN}/health`)).ok);
  return p;
}

export class Service {
  private proc?: ChildProcess;
  constructor(
    private file: string,
    private env: Record<string, string> = {},
    readonly port = 9080,
  ) {}

  async start() {
    const log = fs.openSync(path.join(RUNTIME_DIR, "service.log"), "a");
    this.proc = spawn(process.execPath, ["--import", "tsx", this.file], {
      cwd: root,
      stdio: ["ignore", log, log],
      env: { ...process.env, ...this.env, PORT: String(this.port) },
      detached: true,
    });
    children.push(this.proc);
    await waitFor("the service", portOpen(this.port));
  }

  /** Kill the service the way a crash would: no warning, no cleanup. */
  async kill() {
    if (!this.proc) return;
    killTree(this.proc);
    await waitFor("the service to stop", async () => !(await portOpen(this.port)()));
  }
}

/** Register a service URL with Restate, so Restate knows where to send requests. */
export function register(url = "http://localhost:9080", opts: { force?: boolean; show?: boolean } = {}) {
  const args = ["deployments", "register", url, "--yes"];
  if (opts.force ?? true) args.push("--force");
  return cli(args, { show: opts.show ?? false });
}

/** Run a Restate CLI command. `show` prints it like a terminal session, to teach the command. */
export function cli(args: string[], opts: { show?: boolean; allowFail?: boolean } = {}) {
  const show = opts.show ?? true;
  const shown = args.map((a) => (/[\s'*()<>]/.test(a) ? `"${a}"` : a)).join(" ");
  if (show) console.log(dim(`\n  $ npx restate ${shown}\n`));
  const r = spawnSync(bin("restate"), args, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (show) console.log(out.replace(/^/gm, "    ") + "\n");
  if (r.status !== 0 && !opts.allowFail) throw new Error(`restate ${args.join(" ")} failed:\n${out}`);
  return out;
}

/** Run a SQL query against Restate's introspection tables and return rows. */
export function sql<T = Record<string, unknown>>(query: string): T[] {
  const r = spawnSync(bin("restate"), ["sql", "--json", query], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`restate sql failed: ${r.stderr || r.stdout}`);
  // The CLI prints the rows as a JSON array, followed by a "N rows. Query took…" line.
  const out = r.stdout.trim();
  const end = out.lastIndexOf("]");
  return (end >= 0 ? JSON.parse(out.slice(0, end + 1)) : []) as T[];
}

/** Show a SQL query and its result as a table, the way the CLI would. */
export function showSql(query: string) {
  return cli(["sql", query]);
}

type CallOpts = { idempotencyKey?: string; send?: boolean; delay?: string };

/**
 * Call a handler through Restate's ingress (port 8080), as any client would.
 * target: "Service/handler", "Object/key/handler" or "Workflow/key/run".
 */
export async function call<T = unknown>(target: string, body?: unknown, opts: CallOpts = {}): Promise<{ status: number; body: T }> {
  const url = new URL(`${INGRESS}/${target}${opts.send ? "/send" : ""}`);
  if (opts.delay) url.searchParams.set("delay", opts.delay);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(url, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  return { status: res.status, body: parsed as T };
}

/** Print an HTTP call and its response the way `curl` would show it. */
export async function showCall<T = unknown>(target: string, body?: unknown, opts: CallOpts = {}) {
  const flags = [
    opts.idempotencyKey ? `-H 'idempotency-key: ${opts.idempotencyKey}'` : "",
    body !== undefined ? `--json '${JSON.stringify(body)}'` : "-X POST",
  ].filter(Boolean);
  const q = opts.delay ? `?delay=${opts.delay}` : "";
  console.log(dim(`\n  $ curl ${INGRESS}/${target}${opts.send ? "/send" : ""}${q} ${flags.join(" ")}`));
  const r = await call<T>(target, body, opts);
  const shown = r.body === null ? "(empty response)" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  console.log(`    → HTTP ${r.status} ${shown}\n`);
  return r;
}

/** The status Restate reports for an invocation (pending, running, backing-off, suspended, paused, completed…). */
export function invocationStatus(id: string): string {
  const rows = sql<{ status: string }>(`SELECT status FROM sys_invocation WHERE id = '${id}'`);
  return rows[0]?.status ?? "unknown";
}

export async function waitForStatus(id: string, wanted: string | string[], timeoutMs = 30_000) {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  await waitFor(`invocation ${id} to be ${list.join(" or ")}`, () => list.includes(invocationStatus(id)), timeoutMs);
}

/** Stop everything this harness started, and wait until the ports are free. */
export async function shutdown() {
  cleanup();
  for (const p of [8080, 9070, 9080, 9081]) await waitFor(`port ${p} to close`, async () => !(await portOpen(p)()), 10_000);
}
