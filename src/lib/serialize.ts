import type { Tx } from "./transactions";
export const serializeTx = (t: Tx) => ({
  id: t.id, ref: t.ref, type: t.type, status: t.status, asset: t.asset, amount: t.amount.toString(), fee: t.fee.toString(),
  counterAsset: t.counter_asset, counterAmount: t.counter_amount?.toString() ?? null, rate: t.rate, meta: t.meta,
  failureReason: t.failure_reason, createdAt: t.created_at, completedAt: t.completed_at,
});
export type TxDTO = ReturnType<typeof serializeTx>;
