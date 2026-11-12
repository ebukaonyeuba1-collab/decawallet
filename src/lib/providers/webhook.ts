import { hmacHex, safeEqual } from "../security";

/**
 * Generic HMAC-SHA256 webhook verifier: signature = HMAC(secret, `${timestamp}.${rawBody}`).
 * Real adapters must follow THEIR provider's documented scheme; this is the shape most use.
 * Always verify against the RAW body string, never re-serialised JSON.
 */
export function verifyHmac(opts: { secret: string; rawBody: string; signature: string | null; timestamp: string | null; toleranceSeconds?: number }): boolean {
  const { secret, rawBody, signature, timestamp, toleranceSeconds = 300 } = opts;
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > toleranceSeconds) return false; // replay protection
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  return safeEqual(expected, signature.replace(/^sha256=/, ""));
}

export function signWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  return { timestamp: String(timestamp), signature: hmacHex(secret, `${timestamp}.${rawBody}`) };
}
