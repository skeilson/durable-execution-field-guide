/**
 * Lesson 3.7: a virtual object.
 *
 * A virtual object is a service with a KEY. Each key (here, a customer id)
 * gets its own durable state, stored by Restate. You read and write it with
 * ctx.get / ctx.set: no database to set up.
 *
 * Restate also runs one exclusive handler at a time PER KEY. Two "add" calls
 * for the same customer queue up behind each other, so they can never
 * overwrite each other's changes. Calls for different customers run in
 * parallel. Shared handlers (like `view`) can read at any time without waiting.
 */
import * as restate from "@restatedev/restate-sdk";
import { orders } from "./orders.js";

type CartItem = { sku: string; priceCents: number };

/** Lessons slow `add` down to make queuing visible. */
const ADD_DELAY_MS = Number(process.env.CART_ADD_DELAY_MS ?? 0);

export const cart = restate.object({
  name: "Cart",
  handlers: {
    // Exclusive (the default): one at a time per customer.
    add: async (ctx: restate.ObjectContext, item: CartItem) => {
      const items = (await ctx.get<CartItem[]>("items")) ?? [];
      if (ADD_DELAY_MS) await ctx.sleep(ADD_DELAY_MS, "simulate slow work");
      items.push(item);
      ctx.set("items", items);
      return items.length;
    },

    // Shared: can run alongside exclusive handlers, but can only read state.
    view: restate.handlers.object.shared(async (ctx: restate.ObjectSharedContext) => {
      const items = (await ctx.get<CartItem[]>("items")) ?? [];
      return { customer: ctx.key, items, totalCents: items.reduce((n, i) => n + i.priceCents, 0) };
    }),

    checkout: async (ctx: restate.ObjectContext, address: string) => {
      const items = (await ctx.get<CartItem[]>("items")) ?? [];
      if (items.length === 0) throw new restate.TerminalError("Cart is empty");
      const orderId = `${ctx.key}-${ctx.rand.uuidv4().slice(0, 8)}`; // deterministic: same id on replay
      ctx.clearAll(); // empty the cart
      // Hand the order to the order service without waiting for it to finish.
      ctx.serviceSendClient(orders).checkout({
        orderId,
        sku: items.map((i) => i.sku).join("+"),
        amountCents: items.reduce((n, i) => n + i.priceCents, 0),
        address,
      });
      return orderId;
    },
  },
});
