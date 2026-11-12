import { z } from "zod";
import { one, query, tx as dbTx } from "../db";
import { crypto } from "../providers";
import { Asset, ASSETS, CRYPTO_ASSETS, isAsset, parseAmount, formatAmount, big } from "../money";
import { network, networksFor, withdrawFee, withdrawMin, NGN_BANK_PAYOUT_FEE, BANKS, SWAP_QUOTE_TTL_SECONDS, SWAP_MIN_NGN_VALUE } from "../catalog";
import { computeQuote, ngnValue } from "../rates";
import { ledger, lockWallets } from "../ledger";
import { assertActive, assertWithinOutflowLimit } from "../limits";
import { dispatchToProvider, insertTx, withIdempotency } from "../transactions";
import { sha256 } from "../security";
import { notFound, unprocessable } from "../errors";
import type { User } from "../auth";

const amountStr = z.string().trim().min(1, "Enter an amount").max(40);
const assetSchema = z.string().refine(isAsset, "Choose an asset");

export const depositAddressSchema = z.object({ asset: assetSchema, network: z.string() });
export const withdrawSchema = z.object({ asset: assetSchema, network: z.string(), address: z.string().trim().min(10).max(120), amount: amountStr });
export const bankWithdrawSchema = z.object({ bankCode: z.string(), accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"), amount: amountStr });
export const quoteSchema = z.object({ from: assetSchema, to: assetSchema, amount: amountStr });
export const swapSchema = z.object({ quoteId: z.string().uuid() });
export const resolveSchema = z.object({ bankCode: z.string(), accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits") });

export async function getDepositAddress(user: User, asset: Asset, networkId: string) {
  assertActive(user);
  const net = network(networkId);
  if (!net || !net.assets.includes(asset) || !CRYPTO_ASSETS.includes(asset)) throw unprocessable("That network does not support this asset", "bad_network");
  const found = await one({ query } as any, `select * from deposit_addresses where user_id=$1 and asset=$2 and network=$3`, [user.id, asset, networkId]);
  const row = found ?? await (async () => {
    const p = crypto();
    const a = await p.getDepositAddress({ userId: user.id, asset, network: networkId });
    await query(`insert into deposit_addresses (user_id, asset, network, address, memo, provider) values ($1,$2,$3,$4,$5,$6) on conflict (user_id, asset, network) do nothing`,
      [user.id, asset, networkId, a.address, a.memo ?? null, p.name]);
    return one({ query } as any, `select * from deposit_addresses where user_id=$1 and asset=$2 and network=$3`, [user.id, asset, networkId]);
  })();
  return { address: row.address as string, memo: row.memo as string | null, network: net.label, confirmations: net.confirmations, eta: net.eta, asset };
}

export async function createCryptoWithdrawal(user: User, input: z.infer<typeof withdrawSchema>, key?: string) {
  const asset = input.asset as Asset;
  const net = network(input.network);
  if (!net || !net.assets.includes(asset)) throw unprocessable("That network does not support this asset", "bad_network", { network: "Choose a supported network" });
  const address = input.address.trim();
  if (!net.address.test(address)) throw unprocessable(`That does not look like a valid ${net.label} address. Check it carefully.`, "bad_address", { address: "Invalid address for this network" });
  let amount: bigint;
  try { amount = parseAmount(input.amount, asset); } catch (e) { throw unprocessable((e as Error).message, "bad_amount", { amount: (e as Error).message }); }
  const fee = withdrawFee(asset, net.id), min = withdrawMin(asset, net.id);
  if (amount < min) throw unprocessable(`The minimum withdrawal is ${formatAmount(min, asset)}`, "below_minimum", { amount: `Minimum ${formatAmount(min, asset)}` });

  const hash = sha256(JSON.stringify(["w", asset, net.id, address, amount.toString()]));
  const { tx, replayed } = await withIdempotency(user.id, key, hash, async () => {
    const t = await dbTx(async (q) => {
      await assertWithinOutflowLimit(q, user, asset, amount + fee);
      const t = await insertTx(q, { userId: user.id, type: "crypto_withdrawal", asset, amount, fee, provider: crypto().name, idempotencyKey: key, requestHash: hash, meta: { network: net.id, networkLabel: net.label, address } });
      await ledger.hold(q, user.id, asset, amount + fee, t.id);
      return t;
    });
    return dispatchToProvider(t, () => crypto().createWithdrawal({ ref: t.ref, asset, network: net.id, address, amount }));
  });
  return { tx, replayed };
}

export async function resolveBank(input: z.infer<typeof resolveSchema>) {
  const bank = BANKS.find((b) => b.code === input.bankCode);
  if (!bank) throw unprocessable("Choose a bank", "bad_bank");
  try {
    const r = await crypto().resolveBankAccount(input);
    return { accountName: r.accountName, bankName: bank.name };
  } catch (e) {
    throw unprocessable((e as Error).message || "We could not verify this account", "account_not_found");
  }
}

export async function createNgnWithdrawal(user: User, input: z.infer<typeof bankWithdrawSchema>, key?: string) {
  let amount: bigint;
  try { amount = parseAmount(input.amount, "NGN"); } catch (e) { throw unprocessable((e as Error).message, "bad_amount", { amount: (e as Error).message }); }
  if (amount < 1_000_00n) throw unprocessable("The minimum bank withdrawal is ₦1,000", "below_minimum", { amount: "Minimum ₦1,000" });
  const acct = await resolveBank(input); // server-side name resolution: never trust a client-supplied name
  const fee = NGN_BANK_PAYOUT_FEE;
  const hash = sha256(JSON.stringify(["n", input.bankCode, input.accountNumber, amount.toString()]));
  return withIdempotency(user.id, key, hash, async () => {
    const t = await dbTx(async (q) => {
      await assertWithinOutflowLimit(q, user, "NGN", amount + fee);
      const t = await insertTx(q, { userId: user.id, type: "ngn_withdrawal", asset: "NGN", amount, fee, provider: crypto().name, idempotencyKey: key, requestHash: hash,
        meta: { bankCode: input.bankCode, bankName: acct.bankName, accountNumber: input.accountNumber, accountName: acct.accountName } });
      await ledger.hold(q, user.id, "NGN", amount + fee, t.id);
      return t;
    });
    return dispatchToProvider(t, () => crypto().createBankPayout({ ref: t.ref, amount, bankCode: input.bankCode, accountNumber: input.accountNumber, accountName: acct.accountName }));
  });
}

// ---------------- Swaps ----------------
export async function createQuote(user: User, input: z.infer<typeof quoteSchema>) {
  assertActive(user);
  const from = input.from as Asset, to = input.to as Asset;
  if (from === to) throw unprocessable("Choose two different assets", "same_asset", { to: "Choose a different asset" });
  let amount: bigint;
  try { amount = parseAmount(input.amount, from); } catch (e) { throw unprocessable((e as Error).message, "bad_amount", { amount: (e as Error).message }); }
  if (amount <= 0n) throw unprocessable("Enter an amount above zero", "bad_amount", { amount: "Enter an amount above zero" });
  if (ngnValue(from, amount) < SWAP_MIN_NGN_VALUE) throw unprocessable("The minimum swap is about ₦1,000", "below_minimum", { amount: "Below the minimum swap size (about ₦1,000)" });
  const q = computeQuote(from, to, amount);
  if (q.toAmount <= 0n) throw unprocessable("That amount is too small to convert", "too_small", { amount: "Amount too small" });
  const expires = new Date(Date.now() + SWAP_QUOTE_TTL_SECONDS * 1000);
  const row = await one({ query } as any,
    `insert into quotes (user_id, from_asset, to_asset, from_amount, fee, to_amount, rate, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [user.id, from, to, q.fromAmount.toString(), q.fee.toString(), q.toAmount.toString(), q.rate, expires]);
  return { id: row.id as string, from, to, fromAmount: q.fromAmount.toString(), fee: q.fee.toString(), toAmount: q.toAmount.toString(), rate: q.rate, expiresAt: expires.toISOString(), ttl: SWAP_QUOTE_TTL_SECONDS };
}

export async function executeSwap(user: User, quoteId: string, key?: string) {
  assertActive(user);
  const hash = sha256(`swap:${quoteId}`);
  return withIdempotency(user.id, key, hash, async () => {
    const t = await dbTx(async (q) => {
      const quote = await one(q, `select * from quotes where id=$1 and user_id=$2 for update`, [quoteId, user.id]);
      if (!quote) throw notFound("Quote not found");
      if (quote.used_at) throw unprocessable("This quote was already used", "quote_used");
      if (new Date(quote.expires_at).getTime() < Date.now()) throw unprocessable("This rate has expired. We have not touched your balance. Get a fresh quote.", "quote_expired");
      await q.query(`update quotes set used_at=now() where id=$1`, [quoteId]);
      await lockWallets(q, user.id, [quote.from_asset, quote.to_asset]);
      const t = await insertTx(q, {
        userId: user.id, type: "swap", asset: quote.from_asset, amount: big(quote.from_amount), fee: big(quote.fee),
        counterAsset: quote.to_asset, counterAmount: big(quote.to_amount), rate: quote.rate, provider: crypto().name, idempotencyKey: key, requestHash: hash, meta: { quoteId },
      });
      await ledger.hold(q, user.id, quote.from_asset, big(quote.from_amount), t.id);
      return t;
    });
    return dispatchToProvider(t, () => crypto().executeSwap({ ref: t.ref, from: t.asset, to: t.counter_asset as Asset, fromAmount: t.amount, toAmount: t.counter_amount as bigint, rate: t.rate as string }));
  });
}

export { networksFor, ASSETS };
