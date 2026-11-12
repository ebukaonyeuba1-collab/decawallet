/** Central, validated access to configuration. Server-side only. */

export type Mode = "sandbox" | "live";

export function mode(): Mode {
  return process.env.DECA_MODE === "live" ? "live" : "sandbox";
}
export const isSandbox = () => mode() === "sandbox";
export const isProd = () => process.env.NODE_ENV === "production";

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Live money movement is OFF unless explicitly enabled twice (mode + flag).
 * Provider adapters re-check this before every outbound money call.
 */
export function liveMoneyAllowed(): boolean {
  return mode() === "live" && process.env.ALLOW_LIVE_MONEY === "true";
}

export function requireSecret(name: string): string {
  const v = process.env[name];
  if (v && !v.startsWith("replace-with")) return v;
  if (isProd() && !process.env.DECA_ALLOW_DEV_SECRETS) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  // Stable, clearly-insecure fallback so local development works with zero setup.
  return `dev-only-insecure-${name.toLowerCase()}-do-not-use-in-production`;
}

export function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && !raw.startsWith("replace-with")) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
    return buf;
  }
  if (isProd() && !process.env.DECA_ALLOW_DEV_SECRETS) throw new Error("Missing required environment variable ENCRYPTION_KEY");
  return Buffer.alloc(32, 7); // dev only
}

export function providerName(kind: "CRYPTO" | "BILLS" | "CARDS" | "KYC"): string {
  return (process.env[`${kind}_PROVIDER`] || "mock").toLowerCase();
}
