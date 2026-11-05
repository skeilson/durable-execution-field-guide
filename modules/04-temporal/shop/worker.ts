/**
 * Module 4: the WORKER.
 *
 * A worker is a long-running process you operate. It connects to the Temporal
 * server, polls a task queue ("shop") for work, and runs workflow and activity
 * code. Temporal never calls your code; your worker asks for work. This is the
 * "pull" model (lesson 2.9).
 *
 * Start it with: npm run worker
 * Run as many copies as you like: they share the task queue's work.
 */
import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import * as activities from "./activities.js";

export const TASK_QUEUE = "shop";

/** Which workflow code to load. Lesson 4.10 swaps in a changed version. */
const variant = process.env.WORKFLOWS ?? "workflows";

const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const worker = await Worker.create({
  connection,
  namespace: "default",
  taskQueue: TASK_QUEUE,
  workflowsPath: fileURLToPath(new URL(`./${variant}.ts`, import.meta.url)),
  activities,
});
console.log(`Worker polling task queue "${TASK_QUEUE}" with ${variant}.ts`);
await worker.run();
