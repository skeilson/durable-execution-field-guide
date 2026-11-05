/**
 * Lesson 3.8: a workflow.
 *
 * A workflow is a special kind of virtual object:
 *  - its `run` handler executes exactly once per key (here, per return id);
 *  - other handlers can talk to it while it runs: read its progress, or
 *    complete a durable promise it is waiting on.
 *
 * This return needs a human to approve it. `run` waits on the durable promise
 * "decision". The approval can arrive minutes or weeks later; nothing has to
 * keep running while it waits.
 */
import * as restate from "@restatedev/restate-sdk";
import { bank } from "../../../shared/fake-world.js";

type ReturnRequest = { orderId: string; amountCents: number; reason: string };
type Decision = { approved: boolean; by: string };

export const returns = restate.workflow({
  name: "Returns",
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: ReturnRequest) => {
      ctx.set("status", "waiting for approval");

      const decision = await ctx.promise<Decision>("decision");

      if (!decision.approved) {
        ctx.set("status", `rejected by ${decision.by}`);
        return { refunded: false };
      }
      ctx.set("status", `approved by ${decision.by}, refunding`);
      await ctx.run("refund", () => bank.refund(req.orderId, req.amountCents));
      ctx.set("status", "refunded");
      return { refunded: true };
    },

    // Called by a support agent's tool. Completes the promise `run` is waiting on.
    decide: async (ctx: restate.WorkflowSharedContext, decision: Decision) => {
      await ctx.promise<Decision>("decision").resolve(decision);
      return "recorded";
    },

    // Anyone can check progress while the workflow runs.
    status: async (ctx: restate.WorkflowSharedContext) => (await ctx.get<string>("status")) ?? "not started",
  },
});
