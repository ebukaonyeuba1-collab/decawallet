import { z } from "zod";
import { one, query, tx } from "../db";
import { ensureWallets } from "../ledger";
import { appHmac, hashPassword, sha256, verifyPassword, randomBytesDigits } from "../security";
import { conflict, tooMany, unauthorized, unprocessable, unavailable } from "../errors";
import { isSandbox } from "../env";
import { normalizePhone } from "../catalog";
import { kyc } from "../providers";
import type { User } from "../auth";

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include letters and numbers");
export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(120),
  password: passwordSchema,
});
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

const DUMMY_HASH = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export async function signUp(i: z.infer<typeof signupSchema>): Promise<string> {
  const hash = await hashPassword(i.password);
  return tx(async (q) => {
    const exists = await one(q, `select 1 from users where lower(email)=lower($1)`, [i.email]);
    if (exists) throw conflict("An account with this email already exists. Try signing in.", "email_taken");
    const u = await one(q, `insert into users (email, password_hash, full_name) values ($1,$2,$3) returning id`, [i.email, hash, i.fullName]);
    await ensureWallets(q, u.id);
    return u.id as string;
  });
}

const WINDOW = "15 minutes", MAX_FAILS = 5;
export async function logIn(email: string, password: string, ip: string): Promise<string> {
  const keys = [`email:${email}`, `ip:${ip}`];
  const fails = await query(`select count(*)::int n from auth_attempts where key = any($1) and success=false and created_at > now() - interval '${WINDOW}'`, [keys]);
  if (fails.rows[0].n >= MAX_FAILS * 2) throw tooMany("Too many failed sign-in attempts. Please wait 15 minutes.");
  const emailFails = await query(`select count(*)::int n from auth_attempts where key=$1 and success=false and created_at > now() - interval '${WINDOW}'`, [keys[0]]);
  if (emailFails.rows[0].n >= MAX_FAILS) throw tooMany("Too many failed sign-in attempts for this account. Please wait 15 minutes.");

  const u = await one<User & { password_hash: string }>({ query } as any, `select * from users where lower(email)=lower($1) and status <> 'closed'`, [email]);
  const good = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  await query(`insert into auth_attempts (key, success) values ($1,$2),($3,$2)`, [keys[0], !!(u && good), keys[1]]);
  if (!u || !good) throw unauthorized("Email or password is incorrect");
  return u.id;
}

export async function changePassword(userId: string, current: string, next: string, keepSessionHash: string | null) {
  const u = await one({ query } as any, `select password_hash from users where id=$1`, [userId]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw unprocessable("Your current password is incorrect", "bad_password", { current: "Incorrect password" });
  const hash = await hashPassword(next);
  await tx(async (q) => {
    await q.query(`update users set password_hash=$2, updated_at=now() where id=$1`, [userId, hash]);
    await q.query(`delete from sessions where user_id=$1 and token_hash <> coalesce($2,'')`, [userId, keepSessionHash]);
  });
}

export async function listSessions(userId: string, currentHash: string | null) {
  const r = await query(`select id, user_agent, ip, created_at, token_hash from sessions where user_id=$1 and expires_at > now() order by created_at desc`, [userId]);
  return r.rows.map((s: any) => ({ id: s.id, userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at, current: s.token_hash === currentHash }));
}
export async function revokeOtherSessions(userId: string, currentHash: string | null) {
  await query(`delete from sessions where user_id=$1 and token_hash <> coalesce($2,'')`, [userId, currentHash]);
}

// ---------------- Phone verification (Tier 1) ----------------
export async function requestPhoneOtp(userId: string, phoneRaw: string): Promise<{ sandboxCode?: string }> {
  const phone = normalizePhone(phoneRaw);
  if (!/^0[789][01]\d{8}$/.test(phone)) throw unprocessable("Enter a valid Nigerian mobile number", "invalid_phone", { phone: "Enter a valid Nigerian mobile number" });
  if (!isSandbox()) throw unavailable("SMS verification is not configured yet.");
  const code = randomBytesDigits(6);
  await query(`update users set phone=$2, phone_otp_hash=$3, phone_otp_expires=now() + interval '10 minutes', phone_otp_attempts=0 where id=$1`, [userId, phone, sha256(appHmac(code))]);
  return { sandboxCode: code };
}
export async function verifyPhoneOtp(userId: string, code: string) {
  const u = await one({ query } as any, `select phone_otp_hash h, phone_otp_expires e, phone_otp_attempts a, kyc_tier t from users where id=$1`, [userId]);
  if (!u?.h || new Date(u.e) < new Date()) throw unprocessable("That code has expired. Request a new one.", "otp_expired");
  if (u.a >= 5) throw tooMany("Too many wrong codes. Request a new one.");
  if (sha256(appHmac(code)) !== u.h) {
    await query(`update users set phone_otp_attempts = phone_otp_attempts + 1 where id=$1`, [userId]);
    throw unprocessable("That code is not correct", "otp_invalid", { code: "Incorrect code" });
  }
  await query(`update users set phone_verified_at=now(), phone_otp_hash=null, kyc_tier=greatest(kyc_tier,1), updated_at=now() where id=$1`, [userId]);
}

// ---------------- BVN (Tier 2) ----------------
export async function submitBvn(user: User, bvn: string) {
  if (user.kyc_tier < 1) throw unprocessable("Verify your phone number first", "phone_required");
  if (user.kyc_tier >= 2) return;
  const hash = appHmac(`bvn:${bvn}`);
  const dupe = await one({ query } as any, `select 1 from users where bvn_hash=$1 and id <> $2`, [hash, user.id]);
  if (dupe) throw unprocessable("This BVN is already linked to another account", "bvn_in_use");
  const res = await kyc().verifyBvn({ bvn, fullName: user.full_name });
  if (!res.verified) {
    await query(`update users set kyc_status='rejected', kyc_reject_reason=$2, updated_at=now() where id=$1`, [user.id, res.reason ?? "Verification failed"]);
    throw unprocessable(res.reason ?? "We could not verify this BVN", "bvn_failed", { bvn: res.reason ?? "Verification failed" });
  }
  // Only a keyed hash and the last 4 digits are stored. The full BVN is never persisted or logged.
  await query(`update users set kyc_tier=2, kyc_status='verified', kyc_reject_reason=null, bvn_hash=$2, bvn_last4=$3, updated_at=now() where id=$1`, [user.id, hash, bvn.slice(-4)]);
}

export async function setOnboardingStep(userId: string, step: number, done = false) {
  await query(`update users set onboarding_step=greatest(onboarding_step,$2), onboarded_at = case when $3 then coalesce(onboarded_at, now()) else onboarded_at end where id=$1`, [userId, step, done]);
}
