import { NextRequest, NextResponse } from "next/server";
import { reconcileAll } from "@/lib/transactions";
import { requireSecret } from "@/lib/env";
import { safeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const given = req.headers.get("authorization") ?? "";
  if (!safeEqual(given, `Bearer ${requireSecret("CRON_SECRET")}`)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, checked: await reconcileAll() });
}
