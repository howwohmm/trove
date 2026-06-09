import { NextRequest, NextResponse } from "next/server";
import { openDb, blobToVec } from "@/lib/db";
import { embedTexts } from "@/lib/embed";
import { dot } from "@/lib/taste";

export const dynamic = "force-dynamic";

// type a vibe → your keeps ranked by CLIP text-image cosine
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ items: [] });

  const db = openDb();
  const [qVec] = await embedTexts([q]);

  const rows = db
    .prepare(
      `SELECT DISTINCT i.id, i.width, i.height, i.color, i.blur_data, i.embedding
       FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='keep' AND i.local_path IS NOT NULL AND i.embedding IS NOT NULL`
    )
    .all() as {
    id: string;
    width: number;
    height: number;
    color: string | null;
    blur_data: string | null;
    embedding: Uint8Array;
  }[];

  const ranked = rows
    .map((r) => ({ r, s: dot(qVec, blobToVec(r.embedding)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 60);

  return NextResponse.json({
    items: ranked.map(({ r, s }) => ({
      id: r.id,
      url: `/api/img/${encodeURIComponent(r.id)}`,
      width: r.width,
      height: r.height,
      color: r.color,
      blurData: r.blur_data,
      score: Math.round(s * 1000) / 1000,
    })),
  });
}
