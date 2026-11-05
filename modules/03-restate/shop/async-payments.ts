/**
 * Lesson 3.9: waiting for the outside world with an awakeable.
 *
 * Many payment providers don't answer right away. You start a payment, and
 * minutes later they call a webhook you gave them with the result.
 *
 * An awakeable is a durable "please call me back" ticket:
 *   1. ctx.awakeable() creates one and gives you its id.
 *   2. You hand the id to the outside system (inside ctx.run, so it's done once).
 *   3. You await the awakeable. The invocation suspends: no process needs to run.
 *   4. The outside system (or your webhook handler) completes it through
 *      Restate's HTTP API: POST /restate/awakeables/<id>/resolve
 *   5. Restate wakes the invocation up with the result.
 */
import * as restate from "@restatedev/restate-sdk";
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../../../shared/fake-world.js";

type PaymentResult = { status: "paid" | "failed"; providerRef: string };

/** The fake provider's inbox: payment requests it has been asked to process. */
export const PROVIDER_INBOX = path.join(RUNTIME_DIR, "provider-inbox.jsonl");

export const asyncPayments = restate.service({
  name: "AsyncPayments",
  handlers: {
    pay: async (ctx: restate.Context, req: { orderId: string; amountCents: number }) => {
      const { id, promise } = ctx.awakeable<PaymentResult>();

      await ctx.run("ask provider to start payment", () => {
        fs.mkdirSync(RUNTIME_DIR, { recursive: true });
        fs.appendFileSync(PROVIDER_INBOX, JSON.stringify({ ...req, callbackId: id }) + "\n");
      });

      ctx.console.info(`waiting for provider callback on ${id}`);
      const result = await promise;
      return { orderId: req.orderId, ...result };
    },
  },
});
