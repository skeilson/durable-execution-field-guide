/**
 * Lesson 3.2: the smallest possible Restate service.
 *
 * A service is a group of handlers. A handler is a function Restate can call.
 * Every handler receives `ctx` (Restate's context) and one input value.
 */
import * as restate from "@restatedev/restate-sdk";

export const greeter = restate.service({
  name: "Greeter",
  handlers: {
    greet: async (ctx: restate.Context, name: string) => {
      ctx.console.info(`greeting ${name}`);
      return `Hello, ${name}!`;
    },
  },
});
