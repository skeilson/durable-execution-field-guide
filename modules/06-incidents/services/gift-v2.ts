/**
 * Incident 6.3: version 2 of the gift order service.
 *
 * A new feature: a "we're wrapping your gift" email between reserving and
 * charging. Fine for new orders. Not fine for an order that started on v1 and
 * is replayed on this code: its journal has "charge card" where this code now
 * asks for "send gift email".
 */
import * as restate from "@restatedev/restate-sdk";
import { bank, email, inventory, shipping } from "../../../shared/fake-world.js";

type Order = { orderId: string; sku: string; amountCents: number; address: string; pickupSeconds: number };

const giftOrders = restate.service({
  name: "GiftOrders",
  options: { inactivityTimeout: { seconds: 1 } },
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));
      await ctx.run("send gift email", () => email.send(order.orderId, "We're wrapping your gift")); // NEW
      await ctx.run("charge card", () =>
        bank.charge(order.orderId, order.amountCents, { idempotencyKey: `${order.orderId}/charge` }),
      );
      await ctx.sleep({ seconds: order.pickupSeconds }, "wait for warehouse pickup");
      await ctx.run("ship order", () => shipping.ship(order.orderId, order.address));
      return "v2 shipped";
    },
  },
});

await restate.serve({ services: [giftOrders], port: Number(process.env.PORT ?? 9080) });
console.log("GiftOrders v2 listening");
