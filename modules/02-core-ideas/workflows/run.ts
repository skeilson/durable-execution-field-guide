/**
 * Runs the order workflow on a chosen engine version, in its own process
 * (so lessons can kill it for real).
 *
 * Usage: tsx run.ts <v1..v6> <orderId> [variant]
 *
 * Read the workflow functions below and notice how little they change from
 * version to version: the engine does the hard work, the business logic stays
 * a plain top-to-bottom list of steps.
 */
import { bank, inventory, shipping, email } from "../../../shared/fake-world.js";
import * as v1 from "../engine/v1-journal.js";
import * as v2 from "../engine/v2-replay.js";
import * as v3 from "../engine/v3-idempotency.js";
import * as v4 from "../engine/v4-retries.js";
import * as v5 from "../engine/v5-determinism.js";
import * as v6 from "../engine/v6-timers.js";

const [version, orderId, variant = ""] = process.argv.slice(2);
if (!version || !orderId) {
  console.error("usage: run.ts <v1..v6> <orderId> [variant]");
  process.exit(2);
}
const ADDRESS = "123 Main St, Bozeman MT";

switch (version) {
  // v1 and v2: the same three steps. The only difference is the engine.
  case "v1":
    await v1.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));
      await ctx.step("charge card", () => bank.charge(orderId, 4999));
      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  case "v2":
    await v2.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));
      await ctx.step("charge card", () => bank.charge(orderId, 4999));
      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  // v3: the charge now passes the engine's idempotency key to the bank.
  case "v3":
    await v3.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));
      await ctx.step("charge card", ({ idempotencyKey }) => bank.charge(orderId, 4999, { idempotencyKey }));
      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  // v4: same code as v3. Retries happen inside the engine.
  case "v4":
    await v4.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));
      await ctx.step("charge card", ({ idempotencyKey }) => bank.charge(orderId, 4999, { idempotencyKey }));
      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  // v5: variants that are (or aren't) deterministic.
  case "v5":
    await v5.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));

      if (variant === "added-step") {
        // A new feature someone deployed while orders were in flight.
        await ctx.step("send confirmation email", () => email.send(orderId, "Your order is confirmed"));
      }

      await ctx.step("charge card", ({ idempotencyKey }) => bank.charge(orderId, 4999, { idempotencyKey }));

      if (variant === "random-outside" || variant === "random-inside") {
        // A promotion: half of all orders get free gift wrap.
        // (FORCE_RANDOM lets the lesson pick how the coin lands on each run.)
        const coinFlip = () => (process.env.FORCE_RANDOM ? Number(process.env.FORCE_RANDOM) : Math.random());
        const roll = variant === "random-outside"
          ? coinFlip() // ✘ decided outside the journal: can change on replay
          : await ctx.random("gift wrap roll"); // ✔ journaled: same answer on replay
        if (roll < 0.5) {
          await ctx.step("gift wrap", async () => "wrapped");
        }
      }

      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  // v6: wait for the warehouse with a durable timer.
  case "v6":
    await v6.runWorkflow(orderId, async (ctx) => {
      await ctx.step("reserve inventory", () => inventory.reserve(orderId, "SKU-42"));
      await ctx.step("charge card", ({ idempotencyKey }) => bank.charge(orderId, 4999, { idempotencyKey }));
      await ctx.sleep("warehouse pickup", Number(process.env.WAIT_MS ?? 6000));
      await ctx.step("ship order", () => shipping.ship(orderId, ADDRESS));
    });
    break;

  default:
    console.error(`unknown version ${version}`);
    process.exit(2);
}
