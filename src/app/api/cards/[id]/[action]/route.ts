import { z } from "zod";
import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { serializeTx } from "@/lib/serialize";
import * as c from "@/lib/services/cards";

export const POST = api({}, async ({ params, body, user, idempotencyKey }) => {
  const id = params.id;
  switch (params.action) {
    case "freeze": await c.setFrozen(user, id, true); return {};
    case "unfreeze": await c.setFrozen(user, id, false); return {};
    case "limits": await c.setLimits(user, id, c.limitsSchema.parse(body)); return {};
    case "fund": { const r = await c.fundCard(user, id, c.fundCardSchema.parse(body).amount, idempotencyKey); return { tx: serializeTx(r.tx) }; }
    case "activate": await c.activate(user, id, z.object({ last4: z.string().regex(/^\d{4}$/, "Enter 4 digits") }).parse(body).last4); return {};
    case "reveal": return c.reveal(user, id);
    case "simulate-spend": { const b = z.object({ merchant: z.string().min(2).max(40), amount: z.string() }).parse(body); return c.simulateSpend(user, id, b.merchant, b.amount); }
  }
  throw badRequest("Unknown action");
});
