import { query } from "./db";
import { listWallets } from "./ledger";
import { ngnValue } from "./rates";
import { mapTx } from "./transactions";

export async function dashboardData(userId: string) {
  const q = { query } as any;
  const wallets = await listWallets(q, userId);
  const total = wallets.reduce((s, w) => s + ngnValue(w.asset, w.available), 0n);
  const pendingTotal = wallets.reduce((s, w) => s + ngnValue(w.asset, w.pending_in + w.pending_out), 0n);
  const recent = (await query(`select * from transactions where user_id=$1 order by created_at desc limit 5`, [userId])).rows.map(mapTx);
  const inflight = (await query(`select count(*)::int n from transactions where user_id=$1 and status in ('pending','processing')`, [userId])).rows[0].n as number;
  return { wallets, total, pendingTotal, recent, inflight };
}
