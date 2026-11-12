import { Q, one } from "./db";
import { ASSET_LIST, Asset, big, formatAmount } from "./money";

/**
 * The ledger is the ONLY code path that changes wallet balances. Every change is
 * recorded in `ledger_entries` with before/after state, and the database itself
 * rejects negative balances (CHECK constraints) as a last line of defence.
 *
 *   available    spendable now
 *   pending_in   incoming, not yet spendable (e.g. unconfirmed deposit)
 *   pending_out  held for an outgoing operation that has not settled yet
 */
export class InsufficientFunds extends Error {
  constructor(public asset: Asset, public have: bigint, public need: bigint) {
    super(`Insufficient ${asset} balance. You have ${formatAmount(have, asset)} available but need ${formatAmount(need, asset)}.`);
  }
}

export interface Wallet { id: string; user_id: string; asset: Asset; available: bigint; pending_in: bigint; pending_out: bigint }
const map = (r: any): Wallet => ({ id: r.id, user_id: r.user_id, asset: r.asset, available: big(r.available), pending_in: big(r.pending_in), pending_out: big(r.pending_out) });

export async function ensureWallets(q: Q, userId: string) {
  for (const a of ASSET_LIST) {
    await q.query(`insert into wallets (user_id, asset) values ($1,$2) on conflict (user_id, asset) do nothing`, [userId, a]);
  }
}
export async function listWallets(q: Q, userId: string): Promise<Wallet[]> {
  const r = await q.query(`select * from wallets where user_id=$1`, [userId]);
  const rows = r.rows.map(map);
  return ASSET_LIST.map((a) => rows.find((w) => w.asset === a)).filter(Boolean) as Wallet[];
}
export async function lockWallet(q: Q, userId: string, asset: Asset): Promise<Wallet> {
  const row = await one(q, `select * from wallets where user_id=$1 and asset=$2 for update`, [userId, asset]);
  if (!row) throw new Error(`Wallet ${asset} not found`);
  return map(row);
}
/** Lock several wallets in a stable order so concurrent operations cannot deadlock. */
export async function lockWallets(q: Q, userId: string, assets: Asset[]) {
  for (const a of [...new Set(assets)].sort()) await lockWallet(q, userId, a);
}

interface Delta { a?: bigint; i?: bigint; o?: bigint }
async function post(q: Q, w: Wallet, txId: string | null, op: string, d: Delta): Promise<Wallet> {
  const da = d.a ?? 0n, di = d.i ?? 0n, dout = d.o ?? 0n;
  let row;
  try {
    row = await one(q,
      `update wallets set available = available + $2, pending_in = pending_in + $3, pending_out = pending_out + $4, updated_at = now()
       where id = $1 returning *`, [w.id, da.toString(), di.toString(), dout.toString()]);
  } catch (e: any) {
    if (e?.code === "23514") throw new InsufficientFunds(w.asset, w.available, -da);
    throw e;
  }
  const n = map(row);
  await q.query(
    `insert into ledger_entries (wallet_id, transaction_id, op, d_available, d_pending_in, d_pending_out, available_after, pending_in_after, pending_out_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [w.id, txId, op, da.toString(), di.toString(), dout.toString(), n.available.toString(), n.pending_in.toString(), n.pending_out.toString()],
  );
  return n;
}

export const ledger = {
  /** Move funds from available into pending_out. Fails cleanly if the user cannot afford it. */
  async hold(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    const w = await lockWallet(q, userId, asset);
    if (w.available < amount) throw new InsufficientFunds(asset, w.available, amount);
    return post(q, w, txId, "hold", { a: -amount, o: amount });
  },
  async settleHold(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "settle_hold", { o: -amount });
  },
  async releaseHold(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "release_hold", { a: amount, o: -amount });
  },
  /** A settled debit was reversed by the provider: give the money back. */
  async refund(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "refund", { a: amount });
  },
  async incoming(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "incoming_pending", { i: amount });
  },
  async confirmIncoming(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "incoming_confirmed", { i: -amount, a: amount });
  },
  async cancelIncoming(q: Q, userId: string, asset: Asset, amount: bigint, txId: string) {
    return post(q, await lockWallet(q, userId, asset), txId, "incoming_cancelled", { i: -amount });
  },
  async credit(q: Q, userId: string, asset: Asset, amount: bigint, txId: string, op = "credit") {
    return post(q, await lockWallet(q, userId, asset), txId, op, { a: amount });
  },
  /**
   * Take back a previously credited amount (reversed deposit, etc.). If the user already
   * spent part of it we recover what we can and return the deficit so the caller can flag it.
   */
  async clawback(q: Q, userId: string, asset: Asset, amount: bigint, txId: string): Promise<{ recovered: bigint; deficit: bigint }> {
    const w = await lockWallet(q, userId, asset);
    const take = w.available < amount ? w.available : amount;
    if (take > 0n) await post(q, w, txId, "clawback", { a: -take });
    return { recovered: take, deficit: amount - take };
  },
};

/** Invariant check used by tests and `npm run db:verify`: balances must equal the sum of ledger deltas. */
export async function verifyLedger(q: Q): Promise<{ ok: boolean; problems: string[] }> {
  const r = await q.query(
    `select w.id, w.asset, w.available::text a, w.pending_in::text i, w.pending_out::text o,
            coalesce(sum(l.d_available),0)::text la, coalesce(sum(l.d_pending_in),0)::text li, coalesce(sum(l.d_pending_out),0)::text lo
     from wallets w left join ledger_entries l on l.wallet_id = w.id group by w.id`);
  const problems: string[] = [];
  for (const x of r.rows) {
    if (x.a !== x.la || x.i !== x.li || x.o !== x.lo) {
      problems.push(`wallet ${x.id} (${x.asset}) balance ${x.a}/${x.i}/${x.o} != ledger ${x.la}/${x.li}/${x.lo}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
