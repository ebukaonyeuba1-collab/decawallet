import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { serializeTx } from "@/lib/serialize";
import { Asset } from "@/lib/money";
import * as c from "@/lib/services/crypto";

export const POST = api({}, async ({ params, body, user, idempotencyKey }) => {
  switch (params.action) {
    case "address": { const b = c.depositAddressSchema.parse(body); return c.getDepositAddress(user, b.asset as Asset, b.network); }
    case "withdraw": { const r = await c.createCryptoWithdrawal(user, c.withdrawSchema.parse(body), idempotencyKey); return { tx: serializeTx(r.tx), replayed: r.replayed }; }
    case "bank-resolve": return c.resolveBank(c.resolveSchema.parse(body));
    case "bank-withdraw": { const r = await c.createNgnWithdrawal(user, c.bankWithdrawSchema.parse(body), idempotencyKey); return { tx: serializeTx(r.tx), replayed: r.replayed }; }
    case "quote": return c.createQuote(user, c.quoteSchema.parse(body));
    case "swap": { const r = await c.executeSwap(user, c.swapSchema.parse(body).quoteId, idempotencyKey); return { tx: serializeTx(r.tx), replayed: r.replayed }; }
  }
  throw badRequest("Unknown action");
});
