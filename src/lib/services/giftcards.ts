import { z } from "zod";
import { one, query, tx as dbTx, Q } from "../db";
import { GIFT_BRANDS, GIFT_CURRENCIES, GIFT_EST_REVIEW_MINUTES, GIFT_MAX_IMAGES, GIFT_MAX_IMAGE_BYTES, GIFT_MAX_USD, GIFT_MIN_USD } from "../catalog";
import { big, formatAmount, parseAmount } from "../money";
import { ledger } from "../ledger";
import { appHmac, decryptText, encryptText } from "../security";
import { insertTx } from "../transactions";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import type { User } from "../auth";

export const giftSchemaFields = z.object({
  brand: z.string(), currency: z.string(), cardType: z.enum(["ecode", "physical"]),
  faceValue: z.string().trim().min(1, "Enter the card value").max(12), code: z.string().trim().max(60).optional(),
});

/** Indicative payout in kobo: face value (minor units) x currency factor x brand rate. */
export function indicativePayout(brandId: string, currency: string, faceMinor: bigint): { rate: string; payout: bigint } {
  const b = GIFT_BRANDS.find((x) => x.id === brandId)!, c = GIFT_CURRENCIES[currency];
  const perUsd100 = BigInt(Math.round(c.perUsd * 100));
  const payout = (faceMinor * perUsd100 * BigInt(b.ngnPerUsd)) / 100n;
  const rate = ((BigInt(b.ngnPerUsd) * perUsd100) / 100n).toString();
  return { rate, payout };
}

function sniffImage(buf: Uint8Array): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}

const evt = (q: Q, id: string, to: string, actor: string | null, note?: string) =>
  q.query(`insert into gift_card_events (submission_id, to_status, actor_id, note) values ($1,$2,$3,$4)`, [id, to, actor, note ?? null]);

export async function createSubmission(user: User, fields: z.infer<typeof giftSchemaFields>, files: File[]) {
  if (user.status !== "active") throw forbidden("Your account is restricted.");
  const brand = GIFT_BRANDS.find((b) => b.id === fields.brand);
  if (!brand) throw unprocessable("Choose a gift card brand", "bad_brand", { brand: "Choose a brand" });
  if (!brand.types.includes(fields.cardType)) throw unprocessable(`${brand.label} is not accepted as a ${fields.cardType === "ecode" ? "digital code" : "physical card"}`, "bad_type", { cardType: "Not accepted for this brand" });
  if (!GIFT_CURRENCIES[fields.currency]) throw unprocessable("Choose a currency", "bad_currency", { currency: "Choose a currency" });
  let face: bigint;
  try { face = parseAmount(fields.faceValue, "NGN"); } catch { throw unprocessable("Enter a valid card value", "bad_value", { faceValue: "Enter a valid card value" }); }
  const usd = (Number(face) / 100) / GIFT_CURRENCIES[fields.currency].perUsd;
  if (usd < GIFT_MIN_USD || usd > GIFT_MAX_USD) throw unprocessable(`Card value must be between about ${GIFT_MIN_USD} and ${GIFT_MAX_USD} USD`, "bad_value", { faceValue: `Between about $${GIFT_MIN_USD} and $${GIFT_MAX_USD}` });

  const images = files.filter((f) => f && f.size > 0);
  if (images.length > GIFT_MAX_IMAGES) throw unprocessable(`Upload at most ${GIFT_MAX_IMAGES} images`, "too_many_images", { images: `At most ${GIFT_MAX_IMAGES} images` });
  const loaded: { mime: string; bytes: Buffer }[] = [];
  for (const f of images) {
    if (f.size > GIFT_MAX_IMAGE_BYTES) throw unprocessable(`Each image must be under ${GIFT_MAX_IMAGE_BYTES / 1_000_000} MB. Try a screenshot or a smaller photo.`, "image_too_large", { images: "Image too large" });
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniffImage(bytes);
    if (!mime) throw unprocessable("Only JPEG, PNG or WebP images are accepted", "bad_image", { images: "Unsupported image type" });
    loaded.push({ mime, bytes });
  }
  let code = fields.code?.replace(/\s/g, "");
  if (fields.cardType === "ecode") {
    if (!code || code.length < 6) throw unprocessable("Enter the card code exactly as shown", "code_required", { code: "Enter the card code" });
    if (!/^[A-Za-z0-9-]+$/.test(code)) throw unprocessable("The code can only contain letters, numbers and dashes", "bad_code", { code: "Letters, numbers and dashes only" });
  } else {
    code = undefined;
    if (!loaded.length) throw unprocessable("Upload clear photos of the card (front and back)", "images_required", { images: "Add at least one photo" });
  }

  const open = await one({ query } as any, `select count(*)::int n from gift_card_submissions where user_id=$1 and status in ('submitted','in_review')`, [user.id]);
  if (open.n >= 5) throw unprocessable("You have 5 cards waiting for review. Please wait for some to complete.", "too_many_open");

  const { rate, payout } = indicativePayout(brand.id, fields.currency, face);
  try {
    return await dbTx(async (q) => {
      const row = await one(q,
        `insert into gift_card_submissions (user_id, brand, country, currency, card_type, face_value, code_encrypted, code_last4, code_hash, indicative_rate, indicative_payout, est_review_minutes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [user.id, brand.id, GIFT_CURRENCIES[fields.currency].country, fields.currency, fields.cardType, face.toString(),
          code ? encryptText(code) : null, code ? code.slice(-4) : null, code ? appHmac(`gc:${brand.id}:${code.toUpperCase()}`) : null, rate, payout.toString(), GIFT_EST_REVIEW_MINUTES]);
      for (const img of loaded) await q.query(`insert into gift_card_assets (submission_id, mime, size, data) values ($1,$2,$3,$4)`, [row.id, img.mime, img.bytes.length, img.bytes]);
      await evt(q, row.id, "submitted", user.id, "Submitted by customer");
      return { id: row.id as string, indicativePayout: payout.toString(), estMinutes: GIFT_EST_REVIEW_MINUTES };
    });
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("This card code has already been submitted.", "duplicate_code");
    throw e;
  }
}

// ---------------- Reviewer actions ----------------
async function lockSub(q: Q, id: string) {
  const s = await one(q, `select * from gift_card_submissions where id=$1 for update`, [id]);
  if (!s) throw notFound("Submission not found");
  return s;
}
const audit = (q: Q, actor: string, action: string, id: string, detail: object = {}) =>
  q.query(`insert into audit_log (actor_id, action, entity, entity_id, detail) values ($1,$2,'gift_card',$3,$4)`, [actor, action, id, JSON.stringify(detail)]);

function assertNotOwn(admin: User, s: any) {
  if (s.user_id === admin.id) throw forbidden("You cannot review your own submission");
}

export async function claim(admin: User, id: string) {
  return dbTx(async (q) => {
    const s = await lockSub(q, id); assertNotOwn(admin, s);
    if (s.status === "in_review" && s.reviewer_id === admin.id) return;
    if (s.status !== "submitted") throw unprocessable(`This submission is already ${s.status.replace("_", " ")}`, "bad_state");
    await q.query(`update gift_card_submissions set status='in_review', reviewer_id=$2, updated_at=now() where id=$1`, [id, admin.id]);
    await evt(q, id, "in_review", admin.id, "Review started"); await audit(q, admin.id, "claim", id);
  });
}
export async function approve(admin: User, id: string, payoutNgn: string, note?: string) {
  const payout = parseAmount(payoutNgn, "NGN");
  return dbTx(async (q) => {
    const s = await lockSub(q, id); assertNotOwn(admin, s);
    if (!["submitted", "in_review"].includes(s.status)) throw unprocessable(`This submission is already ${s.status.replace("_", " ")}`, "bad_state");
    if (payout <= 0n) throw unprocessable("Enter a payout above zero", "bad_payout", { payout: "Enter a payout above zero" });
    if (payout > (big(s.indicative_payout) * 3n) / 2n) throw unprocessable(`That is more than 150% of the indicative payout (${formatAmount(big(s.indicative_payout), "NGN")}). Check for a typo.`, "payout_too_high", { payout: "Unusually high" });
    await q.query(`update gift_card_submissions set status='approved', payout_amount=$2, reviewer_id=$3, review_note=$4, reviewed_at=now(), updated_at=now() where id=$1`, [id, payout.toString(), admin.id, note ?? null]);
    await evt(q, id, "approved", admin.id, note); await audit(q, admin.id, "approve", id, { payout: payout.toString() });
  });
}
export async function reject(admin: User, id: string, reason: string) {
  if (reason.trim().length < 10) throw unprocessable("Give the customer a clear reason (at least 10 characters)", "reason_required", { reason: "Give a clear reason" });
  return dbTx(async (q) => {
    const s = await lockSub(q, id); assertNotOwn(admin, s);
    if (!["submitted", "in_review", "approved"].includes(s.status)) throw unprocessable(`This submission is already ${s.status}`, "bad_state");
    await q.query(`update gift_card_submissions set status='rejected', reviewer_id=$2, review_note=$3, reviewed_at=now(), updated_at=now() where id=$1`, [id, admin.id, reason.trim()]);
    await evt(q, id, "rejected", admin.id, reason.trim()); await audit(q, admin.id, "reject", id, { reason: reason.trim() });
  });
}
/** Credits the user's NGN wallet exactly once, guarded by the row lock + status check. */
export async function payout(admin: User, id: string) {
  return dbTx(async (q) => {
    const s = await lockSub(q, id); assertNotOwn(admin, s);
    if (s.status === "paid") return { transactionId: s.transaction_id as string };
    if (s.status !== "approved" || s.transaction_id) throw unprocessable("Only approved submissions can be paid", "bad_state");
    const amount = big(s.payout_amount);
    const t = await insertTx(q, { userId: s.user_id, type: "giftcard_payout", status: "success", asset: "NGN", amount, meta: { submissionId: id, brand: s.brand, faceValue: s.face_value, currency: s.currency } }, "admin", "Gift card payout");
    await q.query(`update transactions set completed_at=now() where id=$1`, [t.id]);
    await ledger.credit(q, s.user_id, "NGN", amount, t.id, "giftcard_payout");
    await q.query(`update gift_card_submissions set status='paid', transaction_id=$2, paid_at=now(), updated_at=now() where id=$1`, [id, t.id]);
    await evt(q, id, "paid", admin.id, "Wallet credited"); await audit(q, admin.id, "payout", id, { amount: amount.toString(), transactionId: t.id });
    return { transactionId: t.id };
  });
}
export async function revealCode(admin: User, id: string) {
  const s = await one({ query } as any, `select code_encrypted, user_id from gift_card_submissions where id=$1`, [id]);
  if (!s?.code_encrypted) throw notFound("No code stored for this submission");
  assertNotOwn(admin, s);
  await query(`insert into audit_log (actor_id, action, entity, entity_id) values ($1,'reveal_code','gift_card',$2)`, [admin.id, id]);
  return decryptText(s.code_encrypted);
}
