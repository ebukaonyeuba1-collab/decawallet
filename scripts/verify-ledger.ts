import { query } from "../src/lib/db";
import { verifyLedger } from "../src/lib/ledger";
verifyLedger({ query } as any).then((r) => {
  console.log(r.ok ? "Ledger OK: every wallet equals the sum of its entries." : "LEDGER MISMATCH:\n" + r.problems.join("\n"));
  process.exit(r.ok ? 0 : 1);
});
