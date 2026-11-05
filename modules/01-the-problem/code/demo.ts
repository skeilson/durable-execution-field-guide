/**
 * Module 1 demo: four ways an ordinary checkout goes wrong.
 * Run with: npm run m1
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearFaults, clearLedger, countFor, setFault } from "../../../shared/fake-world.js";
import { bad, good, heading, pause, predict, reveal, runTs, say } from "../../../shared/term.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHECKOUT = path.join(here, "checkout.ts");

clearLedger();
clearFaults();

function ledger(orderId: string) {
  const reserved = countFor(orderId, "inventory", "reserve");
  const charged = countFor(orderId, "bank", "charge");
  const shipped = countFor(orderId, "shipping", "ship");
  const line = `Ledger for ${orderId}: reserved ${reserved}×, charged ${charged}×, shipped ${shipped}×`;
  if (charged === 1 && shipped === 1) good(line);
  else bad(line);
  return { reserved, charged, shipped };
}

// ---------------------------------------------------------------------------
heading("1 · The happy path");
say("Nothing goes wrong. Three steps, top to bottom.");
runTs(CHECKOUT, ["order-1"]);
ledger("order-1");
say("Ordinary code is fine when the world cooperates. The rest of this demo is");
say("about what happens when it doesn't.");
await pause();

// ---------------------------------------------------------------------------
heading("2 · A crash between steps");
say("This time the process dies right after charging the card.");
await predict("After the crash, what state is order-2 in?", [
  "Nothing happened. It's as if the order never started",
  "Fully complete",
  "Half done: charged but not shipped",
]);
runTs(CHECKOUT, ["order-2"], { CRASH: "after:charge" });
ledger("order-2");
reveal("Half done. The customer paid and nothing will ship. The program had no");
reveal("record of how far it got, and now it isn't running at all.");
await pause();

await predict("Someone notices and simply runs the checkout again. What happens?", [
  "It picks up where it left off and ships",
  "It starts from the top: reserves and charges again, then ships",
  "It refuses to run because the order already exists",
]);
runTs(CHECKOUT, ["order-2"]);
ledger("order-2");
reveal("It started from the top. Plain code has no memory between runs, so the");
reveal("customer was charged twice. Rerunning fixed one problem and caused another.");
await pause();

// ---------------------------------------------------------------------------
heading("3 · A failure that isn't really a failure");
say("The bank charges the card, but its reply gets lost on the network.");
say("Our code sees a timeout error.");
setFault("bank.charge", { mode: "lost-response", times: 1 });
await predict("Our code got an error from the bank. Was the customer charged?", [
  "No. The call failed, so nothing happened",
  "Yes. The charge went through, we just never heard back",
  "There's no way for our code to know",
]);
runTs(CHECKOUT, ["order-3"]);
ledger("order-3");
reveal("The card WAS charged (the ledger shows it), but from inside the program,");
reveal("c) is the honest answer: an error after a request leaves you unable to tell");
reveal("whether the other side acted. This is called an ambiguous failure, and it's");
reveal("the hardest problem in this whole course.");
await pause();

// ---------------------------------------------------------------------------
heading("4 · \"Just add retries\"");
say("A common fix: if the charge fails, try again. Let's try it on two kinds of failure.");

say("First, an honest outage: the bank returns 503 once, then recovers.");
setFault("bank.charge", { mode: "error", times: 1 });
runTs(CHECKOUT, ["order-4a", "--retry"]);
ledger("order-4a");
say("Retrying worked. The first attempt never reached the bank, so trying again was safe.");
await pause();

say("Now the lost reply from scenario 3, with the same retry logic.");
setFault("bank.charge", { mode: "lost-response", times: 1 });
await predict("With retries on, how many times is order-4b charged?", ["Once", "Twice", "Three times"]);
runTs(CHECKOUT, ["order-4b", "--retry"]);
ledger("order-4b");
reveal("Twice. The first attempt succeeded silently, so the retry charged again.");
reveal("Retries fix the failures where nothing happened, and make the ambiguous ones worse.");

clearFaults();
heading("What we learned");
say("1. Programs fail in the middle, leaving work half done.");
say("2. Rerunning from the top repeats work that already happened.");
say("3. Some failures are ambiguous: you can't tell if the other side acted.");
say("4. Naive retries turn ambiguous failures into duplicates.");
say("Durable execution fixes 1 and 2 directly, and gives you the tools to handle");
say("3 and 4 safely. Module 2 builds it from scratch.\n");
