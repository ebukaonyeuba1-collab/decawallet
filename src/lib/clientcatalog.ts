import { BANKS, BILLS, NETWORKS, withdrawFee, withdrawMin } from "./catalog";
import type { NetInfo, BillCat } from "@/components/flows-money";
import type { Asset } from "./money";

export const netsForClient = (): NetInfo[] => NETWORKS.map((n) => ({
  id: n.id, label: n.label, assets: n.assets, eta: n.eta, confirmations: n.confirmations,
  fee: Object.fromEntries(n.assets.map((a) => [a, withdrawFee(a as Asset, n.id).toString()])),
  min: Object.fromEntries(n.assets.map((a) => [a, withdrawMin(a as Asset, n.id).toString()])),
}));
export const billsForClient = (): BillCat[] => Object.entries(BILLS).map(([id, c]) => ({
  id, label: c.label, identifierLabel: c.identifierLabel, fee: c.fee.toString(), min: c.min.toString(), max: c.max.toString(),
  providers: c.providers.map((p) => ({ code: p.code, label: p.label, kinds: p.kinds, plans: p.plans?.map((x) => ({ code: x.code, label: x.label, price: x.price.toString() })) })),
}));
export const banksForClient = () => BANKS;
export const balancesRecord = (ws: { asset: string; available: bigint }[]) => Object.fromEntries(ws.map((w) => [w.asset, w.available.toString()]));
