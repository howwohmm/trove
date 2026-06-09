import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT d.id, d.prompt, d.facet_id, i.width, i.height, i.color, i.local_path
       FROM dreams d JOIN images i ON i.id = d.image_id
       WHERE i.local_path IS NOT NULL
       ORDER BY d.created_at DESC`
    )
    .all() as {
    id: string;
    prompt: string | null;
    facet_id: string | null;
    width: number;
    height: number;
    color: string | null;
    local_path: string;
  }[];

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      url: `/api/img/${encodeURIComponent(r.id)}`,
      width: r.width || 1024,
      height: r.height || 1024,
      color: r.color,
      caption: r.prompt?.slice(0, 120) ?? null,
    })),
  });
}
