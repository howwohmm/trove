import { NextRequest, NextResponse } from "next/server";
import { openDb, blobToVec } from "@/lib/db";
import { dot } from "@/lib/taste";

export const dynamic = "force-dynamic";

// CLIP cosine neighbors of one image among your KEEPS — "more like this".
// id is opaque: only ever used as a db lookup key.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = openDb();

  const target = db.prepare("SELECT embedding FROM images WHERE id=?").get(id) as
    | { embedding: Uint8Array | null }
    | undefined;
  if (!target?.embedding) return NextResponse.json({ items: [] });
  const tVec = blobToVec(target.embedding);

  const rows = db
    .prepare(
      `SELECT DISTINCT i.id, i.width, i.height, i.color, i.embedding
       FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='keep' AND i.local_path IS NOT NULL AND i.embedding IS NOT NULL AND i.id != ?`
    )
    .all(id) as {
    id: string;
    width: number;
    height: number;
    color: string | null;
    embedding: Uint8Array;
  }[];

  const ranked = rows
    .map((r) => ({ r, s: dot(tVec, blobToVec(r.embedding)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);

  return NextResponse.json({
    items: ranked.map(({ r, s }) => ({
      id: r.id,
      url: `/api/img/${encodeURIComponent(r.id)}`,
      width: r.width,
      height: r.height,
      color: r.color,
      score: Math.round(s * 1000) / 1000,
    })),
  });
}
