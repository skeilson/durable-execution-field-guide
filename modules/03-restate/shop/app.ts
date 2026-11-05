/**
 * The shop: every Module 3 service, served from one process on port 9080.
 *
 * Start it with:   npm run shop
 * Then register:   npx restate deployments register http://localhost:9080
 *
 * One process serving several services is common in Restate. Restate routes
 * each request to the right handler, by name.
 */
import * as restate from "@restatedev/restate-sdk";
import { asyncPayments } from "./async-payments.js";
import { cart } from "./cart.js";
import { emails } from "./emails.js";
import { greeter } from "./greeter.js";
import { inventorySync } from "./inventory-sync.js";
import { orderSaga } from "./order-saga.js";
import { orders } from "./orders.js";
import { payments } from "./payments.js";
import { reminders } from "./reminders.js";
import { returns } from "./returns.js";

const port = Number(process.env.PORT ?? 9080);
await restate.serve({
  services: [greeter, orders, payments, emails, inventorySync, cart, returns, asyncPayments, orderSaga, reminders],
  port,
});
console.log(`Shop services listening on :${port}`);
