/**
 * Incident 6.3: version 1 of the gift order service.
 * Run on its own: PORT=9080 tsx gift-v1.ts
 */
import * as restate from "@restatedev/restate-sdk";
import { bank, inventory, shipping } from "../../../shared/fake-world.js";

type Order = { orderId: string; sku: string; amountCents: number; address: string; pickupSeconds: number };

const giftOrders = restate.service({
  name: "GiftOrders",
  options: { inactivityTimeout: { seconds: 1 } }, // suspend quickly while waiting
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));
      await ctx.run("charge card", () =>
        bank.charge(order.orderId, order.amountCents, { idempotencyKey: `${order.orderId}/charge` }),
      );
      await ctx.sleep({ seconds: order.pickupSeconds }, "wait for warehouse pickup");
      await ctx.run("ship order", () => shipping.ship(order.orderId, order.address));
      return "v1 shipped";
    },
  },
});

await restate.serve({ services: [giftOrders], port: Number(process.env.PORT ?? 9080) });
console.log("GiftOrders v1 listening");
