import { z } from "zod";
import { one, query, tx as dbTx } from "../db";
import { bills } from "../providers";
import { BILLS, BillCategory, isBillCategory, normalizePhone } from "../catalog";
import { parseAmount, formatAmount } from "../money";
import { ledger } from "../ledger";
import { assertWithinOutflowLimit } from "../limits";
import { dispatchToProvider, insertTx, withIdempotency } from "../transactions";
import { sha256 } from "../security";
import { notFound, unprocessable } from "../errors";
import type { User } from "../auth";

export const payBillSchema = z.object({
  category: z.string(), providerCode: z.string().max(40), identifier: z.string().trim().min(5).max(20),
  planCode: z.string().max(40).optional(), amount: z.string().max(20).optional(), kind: z.enum(["prepaid", "postpaid"]).optional(),
  save: z.boolean().optional(), label: z.string().trim().max(40).optional(),
});
export const lookupSchema = z.object({ category: z.string(), providerCode: z.string(), identifier: z.string().trim().min(5).max(20), kind: z.enum(["prepaid", "postpaid"]).optional() });
export const beneficiarySchema = z.object({ category: z.string(), providerCode: z.string(), identifier: z.string().trim().min(5).max(20), label: z.string().trim().min(1).max(40) });

function resolve(category: string, providerCode: string, identifierRaw: string, planCode?: string, amountRaw?: string) {
  if (!isBillCategory(category)) throw unprocessable("Choose a bill type", "bad_category");
  const cat = BILLS[category as BillCategory];
  const prov = cat.providers.find((p) => p.code === providerCode);
  if (!prov) throw unprocessable("Choose a provider", "bad_provider", { providerCode: "Choose a provider" });
  const identifier = category === "airtime" || category === "data" ? normalizePhone(identifierRaw) : identifierRaw.replace(/\s/g, "");
  if (!cat.identifier.test(identifier)) throw unprocessable(`Enter a valid ${cat.identifierLabel.toLowerCase()}`, "bad_identifier", { identifier: `Enter a valid ${cat.identifierLabel.toLowerCase()}` });
  let amount: bigint, plan: { code: string; label: string } | undefined;
  if (prov.plans) {
    const p = prov.plans.find((x) => x.code === planCode);
    if (!p) throw unprocessable("Choose a plan", "bad_plan", { planCode: "Choose a plan" });
    amount = p.price; plan = p;  // price comes from OUR catalog, never from the client
  } else {
    try { amount = parseAmount(amountRaw ?? "", "NGN"); } catch (e) { throw unprocessable((e as Error).message, "bad_amount", { amount: (e as Error).message }); }
    if (amount < cat.min || amount > cat.max) throw unprocessable(`Amount must be between ${formatAmount(cat.min, "NGN")} and ${formatAmount(cat.max, "NGN")}`, "bad_amount", { amount: `Between ${formatAmount(cat.min, "NGN")} and ${formatAmount(cat.max, "NGN")}` });
  }
  return { category: category as BillCategory, cat, prov, identifier, amount, fee: cat.fee, plan };
}

export async function lookupCustomer(input: z.infer<typeof lookupSchema>) {
  const r = resolve(input.category, input.providerCode, input.identifier, undefined, "1000");
  const c = await bills().validateCustomer({ category: r.category, providerCode: input.providerCode, identifier: r.identifier, kind: input.kind });
  return { customerName: c.customerName };
}

export async function payBill(user: User, input: z.infer<typeof payBillSchema>, key?: string) {
  const r = resolve(input.category, input.providerCode, input.identifier, input.planCode, input.amount);
  const hash = sha256(JSON.stringify(["b", r.category, input.providerCode, r.identifier, r.amount.toString(), input.planCode ?? "", input.kind ?? ""]));
  const out = await withIdempotency(user.id, key, hash, async () => {
    let customerName: string | undefined;
    if (r.category === "electricity" || r.category === "cable") {
      customerName = (await bills().validateCustomer({ category: r.category, providerCode: input.providerCode, identifier: r.identifier, kind: input.kind }).catch(() => null))?.customerName;
    }
    const t = await dbTx(async (q) => {
      await assertWithinOutflowLimit(q, user, "NGN", r.amount + r.fee);
      const t = await insertTx(q, { userId: user.id, type: "bill_payment", asset: "NGN", amount: r.amount, fee: r.fee, provider: bills().name, idempotencyKey: key, requestHash: hash,
        meta: { category: r.category, categoryLabel: r.cat.label, providerCode: input.providerCode, providerLabel: r.prov.label, identifier: r.identifier, planCode: r.plan?.code, planLabel: r.plan?.label, kind: input.kind, customerName } });
      await ledger.hold(q, user.id, "NGN", r.amount + r.fee, t.id);
      return t;
    });
    return dispatchToProvider(t, () => bills().purchase({ ref: t.ref, category: r.category, providerCode: input.providerCode, identifier: r.identifier, amount: r.amount, planCode: input.planCode, kind: input.kind }));
  });
  if (input.save && !out.replayed) {
    await query(
      `insert into beneficiaries (user_id, category, provider_code, identifier, label) values ($1,$2,$3,$4,$5) on conflict (user_id, category, provider_code, identifier) do update set label=excluded.label`,
      [user.id, r.category, input.providerCode, r.identifier, (input.label || `${r.prov.label} ${r.identifier}`).slice(0, 40)]);
  }
  return out;
}

export async function saveBeneficiary(user: User, input: z.infer<typeof beneficiarySchema>) {
  const r = resolve(input.category, input.providerCode, input.identifier, undefined, "1000");
  const row = await one({ query } as any,
    `insert into beneficiaries (user_id, category, provider_code, identifier, label) values ($1,$2,$3,$4,$5)
     on conflict (user_id, category, provider_code, identifier) do update set label=excluded.label returning id`,
    [user.id, r.category, input.providerCode, r.identifier, input.label]);
  return { id: row.id };
}
export async function deleteBeneficiary(user: User, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const r = await query(`delete from beneficiaries where id=$1 and user_id=$2`, [id, user.id]);
  if (!r.rowCount) throw notFound("Beneficiary not found");
}
export const listBeneficiaries = async (userId: string) =>
  (await query(`select id, category, provider_code, identifier, label from beneficiaries where user_id=$1 order by created_at desc`, [userId])).rows;
