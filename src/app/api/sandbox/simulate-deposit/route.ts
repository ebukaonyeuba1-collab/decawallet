import { z } from "zod";
import { api } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { sandboxToolsEnabled } from "@/lib/providers";
import { getDepositAddress } from "@/lib/services/crypto";
import { parseAmount, Asset } from "@/lib/money";
import { mockCreateDeposit, mockWebhookSecret } from "@/lib/providers/mock";
import { signWebhook } from "@/lib/providers/webhook";
import { processWebhook } from "@/lib/webhooks";
import { randomToken } from "@/lib/security";

/** SANDBOX ONLY: fakes an on-chain deposit and delivers a signed webhook through the real handler. */
export const POST = api({}, async ({ body, user }) => {
  if (!sandboxToolsEnabled()) throw notFound();
  const b = z.object({ asset: z.string(), network: z.string(), amount: z.string(), duplicate: z.boolean().optional() }).parse(body);
  const addr = await getDepositAddress(user, b.asset as Asset, b.network);
  const txHash = `sbx_${randomToken(10)}`;
  await mockCreateDeposit({ txHash, userId: user.id, address: addr.address, asset: b.asset as Asset, network: b.network, amount: parseAmount(b.amount, b.asset as Asset), delay: 20 });
  const raw = JSON.stringify({ id: `evt_${randomToken(8)}`, kind: "deposit", providerRef: txHash });
  const s = signWebhook(mockWebhookSecret(), raw);
  const h = () => new Headers({ "x-deca-signature": s.signature, "x-deca-timestamp": s.timestamp });
  const r = await processWebhook("crypto", raw, h());
  if (b.duplicate) await processWebhook("crypto", raw, h());
  return { outcome: r.body.outcome };
});
