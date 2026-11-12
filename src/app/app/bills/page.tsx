import { requirePageUser } from "@/lib/auth";
import { BillsFlow } from "@/components/flows-money";
import { billsForClient } from "@/lib/clientcatalog";
import { listBeneficiaries } from "@/lib/services/bills";
import { listWallets } from "@/lib/ledger";
import { query } from "@/lib/db";
import { Alert, PageTitle } from "@/components/ui";

export const metadata = { title: "Pay bills" };
export default async function Page() {
  const u = await requirePageUser(); const ws = await listWallets({ query } as any, u.id);
  const ngn = ws.find((w) => w.asset === "NGN")!;
  return <><PageTitle title="Pay bills" sub="Airtime, data, electricity and cable TV, paid from your Naira wallet." />
    {ngn.available === 0n && <div className="mb-4"><Alert title="Your Naira wallet is empty">Swap crypto to Naira or sell a gift card first.</Alert></div>}
    <BillsFlow cats={billsForClient()} saved={(await listBeneficiaries(u.id)) as any} balance={ngn.available.toString()} /></>;
}
