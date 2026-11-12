import { requirePageUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { SandboxBanner } from "@/components/ui";
import { isSandbox } from "@/lib/env";

export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  return <>{isSandbox() && <SandboxBanner />}<Shell name={u.full_name} admin={u.role === "admin"}>{children}</Shell></>;
}
