/** Delete all local demo state (ledger, journals, Restate data). Run with: npm run reset */
import fs from "node:fs";

for (const dir of [".runtime", ".restate-data", "restate-data"]) {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("Local demo state cleared.");
