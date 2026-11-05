/**
 * Module 2 hands-on lessons. Each lesson runs real workflows on one engine
 * version, crashes them on purpose, and asks you to predict what happens.
 *
 *   npm run m2 -- 2.3     run one lesson
 *   npm run m2            run them all in order
 */
import { clearFaults, clearLedger, setFault } from "../../shared/fake-world.js";
import { bold, heading, pause, predict, reveal, say, sleep } from "../../shared/term.js";
import { ledger, run, showJournal } from "./workflows/helpers.js";

const lessons: Record<string, { title: string; run: () => Promise<void> }> = {
  // -------------------------------------------------------------------------
  "2.2": {
    title: "The journal",
    async run() {
      say(`Engine ${bold("v1")} writes down each step's result. Watch the 📝 lines.`);
      run("v1", "order-22a");
      showJournal("v1", "order-22a");
      say("That file is the journal: a list of completed steps and their results.");
      await pause();

      say("Now crash the process right after the card is charged.");
      run("v1", "order-22b", { crash: "after:charge card" });
      showJournal("v1", "order-22b");
      say("The journal survived the crash. It knows the charge happened.");

      await predict("v1 writes a journal but never reads it. Run the order again: how many charges?", [
        "1: the engine sees the charge in the journal and skips it",
        "2: the engine starts from the top and charges again",
      ]);
      run("v1", "order-22b");
      ledger("order-22b");
      reveal("2. A journal nobody reads is just a log. v2 starts using it.");
    },
  },

  // -------------------------------------------------------------------------
  "2.3": {
    title: "Replay",
    async run() {
      say(`Engine ${bold("v2")} reads the journal on startup. Same workflow code, same crash.`);
      run("v2", "order-23", { crash: "after:charge card" });
      showJournal("v2", "order-23");

      await predict("Restart it. What happens to the two steps already in the journal?", [
        "They run again",
        "They're skipped, and their recorded results are handed back to the code",
        "The engine refuses to continue",
      ]);
      run("v2", "order-23");
      ledger("order-23");
      reveal("b. Look for the ↺ lines: those steps were REPLAYED, not re-run. The");
      reveal("code still executed top to bottom, but the engine answered from the journal");
      reveal("until it reached new territory, then carried on for real.");
      await pause();

      say("Run it once more.");
      run("v2", "order-23");
      reveal("A completed workflow stays completed. Running it again is harmless.");
    },
  },

  // -------------------------------------------------------------------------
  "2.4": {
    title: "At-least-once: the gap",
    async run() {
      say("v2 again, but this time the crash lands in the worst possible spot:");
      say("after the bank charged the card, before the engine journaled it.");
      run("v2", "order-24", { crash: "during:charge card" });
      showJournal("v2", "order-24");

      await predict("The journal has no record of the charge. Restart: how many charges?", ["1", "2"]);
      run("v2", "order-24");
      ledger("order-24");
      reveal("2. The engine can only skip what it wrote down. There is always a tiny");
      reveal("window between 'the thing happened' and 'we recorded it'. That's why");
      reveal("durable execution promises each step runs AT LEAST once, not exactly once.");
      reveal("No engine can close this window by itself. Lesson 2.5 shows who can.");
    },
  },

  // -------------------------------------------------------------------------
  "2.5": {
    title: "Idempotency keys",
    async run() {
      say(`Engine ${bold("v3")} hands each step a stable key: "<orderId>/<step name>".`);
      say("The workflow passes it to the bank, like real payment APIs expect.");
      say("Same crash as 2.4: after the bank acted, before the journal write.");
      run("v3", "order-25", { crash: "during:charge card" });

      await predict("Restart. The charge step runs again. How many charges this time?", ["1", "2"]);
      run("v3", "order-25");
      ledger("order-25");
      reveal("1. The step DID run twice, but the second request carried the same key,");
      reveal("so the bank recognized it and returned the original result.");
      reveal(bold("Engine (journal + replay) + outside system (idempotency) = effectively once."));
      reveal("Neither half works alone. Customers who skip the second half get duplicates.");
    },
  },

  // -------------------------------------------------------------------------
  "2.6": {
    title: "Retries and permanent failures",
    async run() {
      say(`Engine ${bold("v4")} retries failed steps with growing delays. Three experiments:`);

      console.log("\n" + bold("A) The bank is down for two attempts, then recovers."));
      setFault("bank.charge", { mode: "error", times: 2 });
      run("v4", "order-26a");
      ledger("order-26a");
      say("Retries with backoff rode out the outage. The workflow code didn't change at all.");
      await pause();

      console.log("\n" + bold("B) The ambiguous failure from Module 1: the bank charges, the reply is lost."));
      setFault("bank.charge", { mode: "lost-response", times: 1 });
      await predict("In Module 1, naive retries charged twice here. Now?", ["1", "2"]);
      run("v4", "order-26b");
      ledger("order-26b");
      reveal("1. The retry reused the step's idempotency key, so the bank ignored it.");
      reveal("This is why retries and idempotency always come as a pair.");
      await pause();

      console.log("\n" + bold("C) The card is declined."));
      setFault("bank.charge", { mode: "decline", times: 1 });
      await predict("Should the engine retry a declined card?", [
        "Yes, 5 times with backoff, like any failure",
        "No, it should stop immediately",
      ]);
      run("v4", "order-26c");
      showJournal("v4", "order-26c");
      reveal("b. A decline is PERMANENT: retrying can't change the answer. Real engines call");
      reveal("this a terminal error (Restate: TerminalError, Temporal: non-retryable error).");
      reveal("Notice the journal: inventory was reserved and never released. Undoing earlier");
      reveal("steps when a later one fails is called a SAGA (compensation). Module 3 builds one.");
      clearFaults();
    },
  },

  // -------------------------------------------------------------------------
  "2.7": {
    title: "Determinism",
    async run() {
      say(`Engine ${bold("v5")} checks that replayed code asks for the same steps, in order.`);
      say("A promotion gives half of all orders free gift wrap, decided by a coin flip.");

      console.log("\n" + bold("A) The coin flip happens outside the journal (plain Math.random())."));
      say("First run: the coin says gift wrap. The process crashes right after wrapping.");
      run("v5", "order-27a", { variant: "random-outside", crash: "after:gift wrap", env: { FORCE_RANDOM: "0.1" } });
      showJournal("v5", "order-27a");
      await predict("Restart. This time the coin lands the other way. What happens?", [
        "It replays fine and ships",
        "It wraps the gift a second time",
        "The engine notices the code took a different path and stops",
      ]);
      run("v5", "order-27a", { variant: "random-outside", env: { FORCE_RANDOM: "0.9" } });
      reveal("c. The journal says position #2 was 'gift wrap', but the code now asked for");
      reveal("'ship order'. The engine can't trust any recorded result after that, so it");
      reveal("stops loudly. Silently mixing up results would be far worse.");
      await pause();

      console.log("\n" + bold("B) Same promotion, but the coin flip is a journaled step: ctx.random()."));
      run("v5", "order-27b", { variant: "random-inside", crash: "after:gift wrap", env: { FORCE_RANDOM: "0.1" } });
      run("v5", "order-27b", { variant: "random-inside", env: { FORCE_RANDOM: "0.9" } });
      ledger("order-27b");
      reveal("The replay got the recorded coin flip (0.1), took the same path, and finished.");
      reveal("Rule: anything that can differ between runs (time, randomness, reading a");
      reveal("config or database) must go through a step so it's journaled.");
      await pause();

      console.log("\n" + bold("C) A code change deployed while an order is in flight."));
      say("An order crashes after charging. Before it restarts, someone ships new code");
      say("that sends a confirmation email right after reserving inventory.");
      run("v5", "order-27c", { crash: "after:charge card" });
      showJournal("v5", "order-27c");
      await predict("The order restarts on the NEW code. What happens?", [
        "It sends the email and carries on",
        "Non-determinism error",
      ]);
      run("v5", "order-27c", { variant: "added-step" });
      reveal("Non-determinism. The journal's #1 is 'charge card'; the new code asks for the");
      reveal("email there. If the new step had been added AFTER the point the order had");
      reveal("reached, it would have worked, which is why these bugs are intermittent and");
      reveal("confusing for customers. Restate and Temporal each have tools for safely");
      reveal("changing code under running workflows: Module 7 covers them.");
    },
  },

  // -------------------------------------------------------------------------
  "2.8": {
    title: "Durable timers",
    async run() {
      say(`Engine ${bold("v6")} adds ctx.sleep(): the order waits 6 seconds for warehouse pickup.`);
      say("The process will crash about 1.5 seconds into the wait.");
      run("v6", "order-28", { crash: "during-sleep:warehouse pickup" });
      showJournal("v6", "order-28");
      say("The journal recorded the WAKE-UP TIME, not '6 seconds'.");
      say("Waiting 2 seconds before restarting…");
      await sleep(2000);

      await predict("Restart. How long does the order wait now?", [
        "The full 6 seconds again",
        "Only the time that's left (about 2.5 seconds)",
        "It doesn't wait at all",
      ]);
      run("v6", "order-28");
      ledger("order-28");
      reveal("b. The deadline survived the crash. If the restart had come after the");
      reveal("deadline, the order would have continued immediately.");
      reveal("Real engines go further: while a workflow sleeps, NO process needs to be");
      reveal("running. The server holds the timer and wakes your code when it's due. That's");
      reveal("how a workflow can wait 30 days for a subscription renewal.");
    },
  },
};

// ---------------------------------------------------------------------------
const requested = process.argv[2];
const ids = requested ? [requested] : Object.keys(lessons);
for (const id of ids) {
  const lesson = lessons[id];
  if (!lesson) {
    console.error(`No lesson ${id}. Available: ${Object.keys(lessons).join(", ")}`);
    process.exit(2);
  }
  clearLedger();
  clearFaults();
  heading(`Lesson ${id} · ${lesson.title}`);
  await lesson.run();
  if (ids.length > 1) await pause("Lesson done. Press Enter for the next one…");
}
console.log();
