import { randomBytes, randomInt, scrypt as _scrypt, createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";
import { encryptionKey, requireSecret } from "./env";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const dk = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: R, p: P });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (key: string, data: string | Buffer) => createHmac("sha256", key).update(data).digest("hex");
export const appHmac = (data: string) => hmacHex(requireSecret("SESSION_SECRET"), data);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decryptText(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function humanRef(prefix = "DCA"): string {
  // Unambiguous alphabet (no 0/O/1/I) for receipts read over the phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}-${out.slice(0, 5)}${out.slice(5)}`;
}

export function randomBytesDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += randomInt(0, 10);
  return out;
}
