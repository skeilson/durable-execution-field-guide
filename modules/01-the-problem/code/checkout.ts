/**
 * Module 1: a checkout written the "normal" way.
 *
 * Three steps, top to bottom. This is how most code is written, and it works
 * perfectly as long as nothing goes wrong. The demo shows what happens when
 * something does.
 *
 * Usage: tsx checkout.ts <orderId> [--retry]
 *   CRASH=after:charge   kill the process right after the card is charged
 *   --retry              retry a failed charge up to 3 times
 */
import { bank, inventory, shipping } from "../../../shared/fake-world.js";

const orderId = process.argv[2] ?? "order-1";
const retry = process.argv.includes("--retry");

async function chargeWithOptionalRetry() {
  const attempts = retry ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await bank.charge(orderId, 4999);
    } catch (err) {
      console.log(`  ⚠ charge attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt >= attempts) throw err;
      console.log("  ↻ retrying…");
    }
  }
}

console.log(`  ▶ reserve inventory`);
await inventory.reserve(orderId, "SKU-42");

console.log(`  ▶ charge card`);
try {
  await chargeWithOptionalRetry();
} catch (err) {
  console.log(`  ❌ checkout failed: ${(err as Error).message}`);
  process.exit(1);
}

if (process.env.CRASH === "after:charge") {
  console.log("  💥 process crashed (power cut, out of memory, deploy…)");
  process.exit(137);
}

console.log(`  ▶ ship order`);
await shipping.ship(orderId, "123 Main St, Bozeman MT");
console.log("  ✅ order complete");
