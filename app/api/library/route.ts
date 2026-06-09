import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = openDb();
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 60)));

  const rows = db
    .prepare(
      `SELECT DISTINCT i.id, i.width, i.height, i.color, i.blur_data, i.author, i.source, s.created_at
       FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='keep' AND i.local_path IS NOT NULL
       ORDER BY s.seq DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as {
    id: string;
    width: number;
    height: number;
    color: string | null;
    blur_data: string | null;
    author: string | null;
    source: string;
  }[];

  const total = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT image_id) AS n FROM swipes s JOIN images i ON i.id=s.image_id WHERE s.action='keep' AND i.local_path IS NOT NULL"
      )
      .get() as { n: number }
  ).n;

  return NextResponse.json({
    total,
    items: rows.map((r) => ({
      id: r.id,
      url: `/api/img/${encodeURIComponent(r.id)}`,
      width: r.width,
      height: r.height,
      color: r.color,
      blurData: r.blur_data,
      author: r.author,
      source: r.source,
    })),
  });
}
