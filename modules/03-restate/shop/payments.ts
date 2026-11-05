/**
 * Lessons 3.4, 3.5 and 3.9: the payment service.
 *
 * It wraps the fake bank. Two things to notice:
 *
 *  - The idempotency key passed to the bank comes from the order id, which is
 *    the same on every retry. A retry after a lost response is harmless.
 *
 *  - A declined card is turned into a TerminalError. That tells Restate "do
 *    not retry this": the error goes straight back to whoever called us.
 *    Any other error (a 503, a timeout) is retried automatically.
 */
import * as restate from "@restatedev/restate-sdk";
import { bank, PermanentError } from "../../../shared/fake-world.js";

export type ChargeRequest = { orderId: string; amountCents: number };

export const payments = restate.service({
  name: "Payments",
  handlers: {
    charge: async (ctx: restate.Context, req: ChargeRequest) => {
      return ctx.run("call the bank", async () => {
        try {
          return await bank.charge(req.orderId, req.amountCents, { idempotencyKey: `${req.orderId}/charge` });
        } catch (err) {
          if (err instanceof PermanentError) throw new restate.TerminalError(`Card declined for ${req.orderId}`);
          throw err; // anything else: let Restate retry
        }
      });
    },

    refund: async (ctx: restate.Context, req: ChargeRequest) => {
      return ctx.run("refund at the bank", () => bank.refund(req.orderId, req.amountCents));
    },
  },
});
