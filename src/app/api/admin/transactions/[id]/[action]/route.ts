import { z } from "zod";
import { api } from "@/lib/http";
import { badRequest, notFound } from "@/lib/errors";
import { one, query } from "@/lib/db";
import { mapTx, reconcileTx } from "@/lib/transactions";
import { sandboxToolsEnabled } from "@/lib/providers";
import { mockForce, mockRefOf, mockWebhookSecret } from "@/lib/providers/mock";
import { signWebhook } from "@/lib/providers/webhook";
import { processWebhook } from "@/lib/webhooks";
import { randomToken } from "@/lib/security";

export const POST = api({ auth: "admin" }, async ({ params, body, user }) => {
  const row = await one({ query } as any, `select * from transactions where id=$1`, [params.id]);
  if (!row) throw notFound("Transaction not found");
  const t = mapTx(row);
  if (params.action === "reconcile") { await reconcileTx(t.id, "admin"); return {}; }
  if (params.action === "resolve-flag") {
    await query(`update reconciliation_flags set resolved_at=now(), resolved_by=$2 where transaction_id=$1 and resolved_at is null`, [t.id, user.id]);
    await query(`insert into audit_log (actor_id, action, entity, entity_id) values ($1,'resolve_flags','transaction',$2)`, [user.id, t.id]);
    return {};
  }
  if (params.action === "simulate") {
    if (!sandboxToolsEnabled()) throw notFound();
    const b = z.object({ state: z.enum(["processing", "success", "failed", "reversed"]) }).parse(body);
    const deposit = t.type === "crypto_deposit";
    if (!t.provider_ref && deposit) throw badRequest("No provider reference");
    await mockForce(deposit ? t.provider_ref! : mockRefOf(t.ref), b.state, b.state === "failed" || b.state === "reversed" ? "Simulated by admin" : undefined);
    const category = t.type === "bill_payment" ? "bills" : "crypto";
    const raw = JSON.stringify({ id: `adm_${randomToken(8)}`, kind: deposit ? "deposit" : "operation", ref: t.ref, providerRef: t.provider_ref });
    const s = signWebhook(mockWebhookSecret(), raw);
    const r = await processWebhook(category, raw, new Headers({ "x-deca-signature": s.signature, "x-deca-timestamp": s.timestamp }));
    return r.body;
  }
  throw badRequest("Unknown action");
});
