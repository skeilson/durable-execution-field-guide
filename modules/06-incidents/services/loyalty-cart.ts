/**
 * Incident 6.6: a hot key.
 *
 * A cart virtual object gained a new handler: recalculating the customer's
 * loyalty rewards, which calls a slow partner API. It was written as an
 * ordinary (exclusive) handler, so while it runs, every other request for that
 * customer's cart waits in line behind it.
 */
import * as restate from "@restatedev/restate-sdk";
import { readLedger } from "../../../shared/fake-world.js";

type Item = { sku: string; priceCents: number };

const PARTNER_API_SECONDS = Number(process.env.PARTNER_API_SECONDS ?? 12);

/** The slow partner API (takes PARTNER_API_SECONDS to answer). */
async function partnerRewardsApi(customer: string): Promise<number> {
  await new Promise((r) => setTimeout(r, PARTNER_API_SECONDS * 1000));
  return customer.length * 10 + readLedger().length;
}

export const loyaltyCart = restate.object({
  name: "LoyaltyCart",
  handlers: {
    add: async (ctx: restate.ObjectContext, item: Item) => {
      const items = (await ctx.get<Item[]>("items")) ?? [];
      items.push(item);
      ctx.set("items", items);
      return items.length;
    },

    // ⚠ Exclusive by default: blocks the customer's cart for as long as the partner API takes.
    recalculateRewards: async (ctx: restate.ObjectContext) => {
      const points = await ctx.run("ask partner for rewards", () => partnerRewardsApi(ctx.key));
      ctx.set("points", points);
      return points;
    },

    // The fix: fetch outside the queue (shared handler), then write the result
    // with a quick exclusive call.
    refreshRewards: restate.handlers.object.shared(async (ctx: restate.ObjectSharedContext) => {
      const points = await ctx.run("ask partner for rewards", () => partnerRewardsApi(ctx.key));
      ctx.objectSendClient(loyaltyCart, ctx.key).storePoints(points);
      return points;
    }),

    storePoints: async (ctx: restate.ObjectContext, points: number) => {
      ctx.set("points", points);
    },
  },
});
