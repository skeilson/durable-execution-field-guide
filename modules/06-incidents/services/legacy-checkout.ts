/**
 * Incident 6.2: a checkout written by a team migrating from a queue-based
 * system. It looks fine, and it's durable. But the bank call doesn't pass an
 * idempotency key.
 *
 * Most of the time that never matters. When the bank's reply is lost (a timeout
 * after the bank already charged), ctx.run retries the step and the customer is
 * charged again.
 */
import * as restate from "@restatedev/restate-sdk";
import { bank, inventory, shipping } from "../../../shared/fake-world.js";

type Order = { orderId: string; sku: string; amountCents: number; address: string };

export const legacyCheckout = restate.service({
  name: "LegacyCheckout",
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));
      await ctx.run("charge card", () => bank.charge(order.orderId, order.amountCents)); // ⚠ no idempotency key
      await ctx.run("ship order", () => shipping.ship(order.orderId, order.address));
      return "ok";
    },
  },
});

/** The fix: the same code, with a stable idempotency key on the charge. */
export const fixedCheckout = restate.service({
  name: "FixedCheckout",
  handlers: {
    checkout: async (ctx: restate.Context, order: Order) => {
      await ctx.run("reserve inventory", () => inventory.reserve(order.orderId, order.sku));
      await ctx.run("charge card", () =>
        bank.charge(order.orderId, order.amountCents, { idempotencyKey: `${order.orderId}/charge` }),
      );
      await ctx.run("ship order", () => shipping.ship(order.orderId, order.address));
      return "ok";
    },
  },
});
