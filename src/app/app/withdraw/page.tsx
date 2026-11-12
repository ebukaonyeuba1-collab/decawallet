import { requirePageUser } from "@/lib/auth";
import { WithdrawFlow } from "@/components/flows-money";
import { balancesRecord, banksForClient, netsForClient } from "@/lib/clientcatalog";
import { listWallets } from "@/lib/ledger";
import { query } from "@/lib/db";
import { Alert, PageTitle } from "@/components/ui";

export const metadata = { title: "Withdraw" };
export default async function Page() {
  const u = await requirePageUser(); const ws = await listWallets({ query } as any, u.id);
  return <><PageTitle title="Withdraw" sub="Fees are shown before you confirm." />{u.kyc_tier < 1 && <div className="mb-4"><Alert tone="warn" title="Verify your phone to withdraw">Go to Profile to verify. It takes under a minute.</Alert></div>}<WithdrawFlow nets={netsForClient()} banks={banksForClient()} balances={balancesRecord(ws)} /></>;
}
