import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUser();
  if (!u || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const r = await query(`select a.mime, a.data, s.user_id from gift_card_assets a join gift_card_submissions s on s.id=a.submission_id where a.id=$1`, [id]);
  const row = r.rows[0];
  if (!row || (row.user_id !== u.id && u.role !== "admin")) return new NextResponse("Not found", { status: 404 });
  const data = row.data instanceof Uint8Array ? row.data : Buffer.from(row.data);
  return new NextResponse(data as BodyInit, { headers: { "Content-Type": row.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
