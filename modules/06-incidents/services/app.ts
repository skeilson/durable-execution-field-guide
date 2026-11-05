/**
 * The services the incidents run against: the Module 3 shop plus the
 * incident-specific services in this folder. Served on port 9080.
 * (Incident 6.3 runs its two versions separately: gift-v1.ts and gift-v2.ts.)
 */
import * as restate from "@restatedev/restate-sdk";
import { emails } from "../../03-restate/shop/emails.js";
import { orders } from "../../03-restate/shop/orders.js";
import { payments } from "../../03-restate/shop/payments.js";
import { fixedCheckout, legacyCheckout } from "./legacy-checkout.js";
import { loyaltyCart } from "./loyalty-cart.js";
import { stockSync } from "./stock-sync.js";

await restate.serve({
  services: [orders, payments, emails, legacyCheckout, fixedCheckout, stockSync, loyaltyCart],
  port: Number(process.env.PORT ?? 9080),
});
console.log("Incident services listening");
