/**
 * Incident 6.4: nightly stock sync against a supplier API.
 *
 * Someone rotated the supplier API key and didn't update the service. Every
 * call now fails with 401. The handler throws an ordinary Error, so Restate
 * treats it as transient and keeps retrying with the DEFAULT retry policy.
 * Nothing alerts. Orders keep "syncing" for an hour before pausing.
 */
import * as restate from "@restatedev/restate-sdk";
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../../../shared/fake-world.js";

/** The incident "rotates the key into the config" by creating this file. */
export const SUPPLIER_KEY_FILE = path.join(RUNTIME_DIR, "supplier-api-key");

export const stockSync = restate.service({
  name: "StockSync",
  handlers: {
    sync: async (ctx: restate.Context, sku: string) => {
      const level = await ctx.run("fetch stock level from supplier", async () => {
        if (!fs.existsSync(SUPPLIER_KEY_FILE)) throw new Error("supplier API: 401 Unauthorized (API key revoked)");
        return 17;
      });
      return `${sku}: ${level}`;
    },
  },
});
