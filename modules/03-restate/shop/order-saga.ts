/**
 * Lesson 3.10: a saga.
 *
 * If a later step fails for good, earlier steps must be undone. The pattern:
 * every time a step succeeds, remember how to undo it. If something fails
 * with a TerminalError, run the undo steps (compensations) in reverse order,
 * then fail.
 *
 * Durable execution makes this reliable: the compensations are durable steps
 * too, so a crash halfway through undoing can't leave the order half undone.
 */
import * as restate from "@restatedev/restate-sdk";
import { inventory, PermanentError, shipping } from "../../../shared/fake-world.js";
import { payments } from "./payments.js";
import type { Order } from "./orders.js";

export const orderSaga = restate.service({
  name: "OrderSaga",
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      const compensations: Array<{ name: string; undo: () => Promise<unknown> }> = [];

      try {
        await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));
        compensations.push({
          name: "release inventory",
          undo: () => ctx.run("release inventory", () => inventory.release(order.orderId, order.sku)),
        });

        await ctx.serviceClient(payments).charge({ orderId: order.orderId, amountCents: order.amountCents });
        compensations.push({
          name: "refund",
          undo: () => ctx.serviceClient(payments).refund({ orderId: order.orderId, amountCents: order.amountCents }),
        });

        await ctx.run("ship order", async () => {
          try {
            return await shipping.ship(order.orderId, order.address);
          } catch (err) {
            // The carrier rejecting the address will never fix itself.
            if (err instanceof PermanentError) {
              throw new restate.TerminalError(`Carrier rejected the address "${order.address}": not a deliverable address`);
            }
            throw err;
          }
        });

        return { orderId: order.orderId, status: "shipped" };
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err; // not final: let Restate retry
        ctx.console.warn(`order ${order.orderId} failed: ${err.message}. Undoing ${compensations.length} step(s).`);
        for (const c of compensations.reverse()) await c.undo();
        throw err; // the order still failed; the caller should know
      }
    },
  },
});
