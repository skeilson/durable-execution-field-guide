/**
 * Lessons 3.3, 3.4, 3.5 and 3.6: the order service.
 *
 * Read `checkout` top to bottom. It is ordinary step-by-step code, and every
 * line that touches the outside world goes through `ctx`, so Restate journals
 * it:
 *
 *   ctx.run(...)                    a side effect, run once and journaled
 *   ctx.serviceClient(...).x(...)   call another service and wait for the answer
 *   ctx.serviceSendClient(...)      send a message to another service, don't wait
 *   ctx.sleep(...)                  a durable timer
 */
import * as restate from "@restatedev/restate-sdk";
import { inventory, shipping } from "../../../shared/fake-world.js";
import { emails } from "./emails.js";
import { payments } from "./payments.js";

export type Order = { orderId: string; sku: string; amountCents: number; address: string };

/** Seconds to wait for warehouse pickup. Lessons shorten or lengthen it. */
const PICKUP_WAIT = Number(process.env.PICKUP_WAIT_SECONDS ?? 5);

export const orders = restate.service({
  name: "Orders",
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      ctx.console.info(`checkout started for ${order.orderId}`);

      // 1. A side effect inside ctx.run: executed once, then journaled.
      const reservation = await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));

      // 2. Call another service and wait for its answer (request-response).
      //    If Payments throws a TerminalError (card declined), it surfaces here.
      const payment = await ctx
        .serviceClient(payments)
        .charge({ orderId: order.orderId, amountCents: order.amountCents });

      // 3. Fire-and-forget: Restate delivers it, we don't wait for the result.
      ctx.serviceSendClient(emails).send({ orderId: order.orderId, subject: "Thanks for your order" });

      // 4. A durable timer.
      await ctx.sleep({ seconds: PICKUP_WAIT }, "wait for warehouse pickup");

      // 5. Another side effect.
      const tracking = await ctx.run("ship order", () => shipping.ship(order.orderId, order.address));

      // 6. A delayed message: ask for a review later. Restate holds it until then.
      ctx
        .serviceSendClient(emails)
        .send({ orderId: order.orderId, subject: "How was your order?" }, restate.rpc.sendOpts({ delay: { seconds: 3 } }));

      ctx.console.info(`checkout finished for ${order.orderId}`);
      return { orderId: order.orderId, reservation, payment, tracking };
    },
  },
});
