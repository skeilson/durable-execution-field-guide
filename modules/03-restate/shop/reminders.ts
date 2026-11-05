/**
 * Lesson 3.6: timers and suspension.
 *
 * `remind` waits, then sends an email. While it waits, the invocation is
 * SUSPENDED: Restate holds the timer, and no service process needs to be
 * running. When the timer fires, Restate calls the service again and replays
 * the journal up to the line after the sleep.
 *
 * Restate normally keeps a waiting invocation's connection open for a while
 * (the "inactivity timeout") before suspending it, which saves a reconnect for
 * short waits. This service sets it to 1 second so you can watch suspension
 * happen quickly.
 */
import * as restate from "@restatedev/restate-sdk";
import { email } from "../../../shared/fake-world.js";

export const reminders = restate.service({
  name: "Reminders",
  options: { inactivityTimeout: { seconds: 1 } },
  handlers: {
    remind: async (ctx: restate.Context, req: { orderId: string; inSeconds: number }) => {
      await ctx.sleep({ seconds: req.inSeconds }, "wait until reminder is due");
      await ctx.run("send reminder", () => email.send(req.orderId, "Your cart misses you"));
      return "reminded";
    },
  },
});
