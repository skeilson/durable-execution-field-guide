/**
 * Lessons 3.4 and 3.6: an email service.
 *
 * The order service calls this with a one-way "send" (it doesn't wait for the
 * email to go out) and with a delayed send (a review request a few seconds
 * later). Both are durable: once Restate accepts the send, the email will go
 * out even if every process crashes in between.
 */
import * as restate from "@restatedev/restate-sdk";
import { email } from "../../../shared/fake-world.js";

export type EmailRequest = { orderId: string; subject: string };

export const emails = restate.service({
  name: "Emails",
  handlers: {
    send: async (ctx: restate.Context, req: EmailRequest) => {
      await ctx.run("send email", () => email.send(req.orderId, req.subject));
      return "sent";
    },
  },
});
