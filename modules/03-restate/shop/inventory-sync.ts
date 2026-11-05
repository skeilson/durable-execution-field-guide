/**
 * Lesson 3.5: a handler with its own retry policy.
 *
 * It syncs stock levels with a supplier's API that is broken right now. It
 * throws an ordinary error (not a TerminalError), so Restate retries it. This
 * handler's retry policy allows 4 attempts, then PAUSES the invocation:
 * nothing is lost, nothing keeps hammering the supplier, and a person can fix
 * the cause and resume it.
 */
import * as restate from "@restatedev/restate-sdk";
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../../../shared/fake-world.js";

/** The lesson "fixes the supplier" by creating this file. */
const SUPPLIER_FIXED = path.join(RUNTIME_DIR, "supplier-fixed");

export const inventorySync = restate.service({
  name: "InventorySync",
  handlers: {
    sync: restate.handlers.handler(
      {
        retryPolicy: {
          maxAttempts: 4,
          initialInterval: { milliseconds: 300 },
          exponentiationFactor: 2,
          onMaxAttempts: "pause",
        },
      },
      async (ctx: restate.Context, sku: string) => {
        const level = await ctx.run("ask supplier for stock level", async () => {
          if (!fs.existsSync(SUPPLIER_FIXED)) throw new Error("supplier API: 500 Internal Server Error");
          return 42;
        });
        return `${sku}: ${level} in stock`;
      },
    ),
  },
});
