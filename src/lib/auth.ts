import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { one, query } from "./db";
import { isProd } from "./env";
import { forbidden, unauthorized } from "./errors";
import { randomToken, sha256 } from "./security";

export const COOKIE = "deca_session";
const TTL_DAYS = 14;

export interface User {
  id: string; email: string; full_name: string; phone: string | null; phone_verified_at: Date | null;
  role: "user" | "admin"; status: "active" | "restricted" | "closed"; kyc_tier: 0 | 1 | 2; kyc_status: "none" | "pending" | "verified" | "rejected";
  kyc_reject_reason: string | null; bvn_last4: string | null; onboarding_step: number; onboarded_at: Date | null; created_at: Date;
}

export async function createSession(userId: string, meta: { ua?: string | null; ip?: string | null } = {}) {
  const token = randomToken(32);
  await query(`insert into sessions (user_id, token_hash, user_agent, ip, expires_at) values ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
    [userId, sha256(token), meta.ua?.slice(0, 200) ?? null, meta.ip ?? null, String(TTL_DAYS)]);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd(), path: "/", maxAge: TTL_DAYS * 86400 });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await query(`delete from sessions where token_hash=$1`, [sha256(token)]);
  jar.delete(COOKIE);
}

export const getUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = await one({ query } as any,
    `select u.* from sessions s join users u on u.id = s.user_id where s.token_hash=$1 and s.expires_at > now() and u.status <> 'closed'`, [sha256(token)]);
  return row ?? null;
});

export const currentSessionHash = async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha256(token) : null;
};

/** For pages: redirect instead of throwing. */
export async function requirePageUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}
export async function requirePageAdmin(): Promise<User> {
  const u = await requirePageUser();
  if (u.role !== "admin") redirect("/app");
  return u;
}
/** For API routes: throw typed errors. */
export async function requireApiUser(): Promise<User> {
  const u = await getUser();
  if (!u) throw unauthorized();
  return u;
}
export async function requireApiAdmin(): Promise<User> {
  const u = await requireApiUser();
  if (u.role !== "admin") throw forbidden();
  return u;
}
