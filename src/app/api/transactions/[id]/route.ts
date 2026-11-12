import { api } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { query } from "@/lib/db";
import { getTxForUser, reconcileTx } from "@/lib/transactions";
import { serializeTx } from "@/lib/serialize";

/** Polled by the receipt screen while a transaction is in flight. Each poll re-verifies with the provider server-side. */
export const GET = api({}, async ({ params, user }) => {
  let t = await getTxForUser(user.id, params.id);
  if (!t) throw notFound("Transaction not found");
  if (t.status === "pending" || t.status === "processing") t = (await reconcileTx(t.id, "reconcile")) ?? t;
  const events = (await query(`select from_status, to_status, source, note, created_at from transaction_events where transaction_id=$1 order by id`, [t.id])).rows;
  return { tx: serializeTx(t), events };
});
