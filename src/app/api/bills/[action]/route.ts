import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { serializeTx } from "@/lib/serialize";
import * as b from "@/lib/services/bills";

export const POST = api({}, async ({ params, body, user, idempotencyKey }) => {
  switch (params.action) {
    case "pay": { const r = await b.payBill(user, b.payBillSchema.parse(body), idempotencyKey); return { tx: serializeTx(r.tx), replayed: r.replayed }; }
    case "lookup": return b.lookupCustomer(b.lookupSchema.parse(body));
    case "beneficiary": return b.saveBeneficiary(user, b.beneficiarySchema.parse(body));
  }
  throw badRequest("Unknown action");
});
export const DELETE = api({}, async ({ params, user }) => { await b.deleteBeneficiary(user, params.action); return {}; });
