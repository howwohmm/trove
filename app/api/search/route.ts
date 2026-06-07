import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/store";
import { cachedEmbeddings } from "@/lib/embeddings";
import { embedTexts } from "@/lib/embed";
import { cosine } from "@/lib/taste";
import type { LibraryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// CLIP text→image search over your library: type a vibe, rank by similarity.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const [lib, emb] = await Promise.all([getLibrary(), cachedEmbeddings()]);
  const [qvec] = await embedTexts([q]);
  if (!qvec) return NextResponse.json({ results: [] });

  const results = lib
    .filter((l) => emb[l.id])
    .map((l) => ({ item: l, score: cosine(qvec, emb[l.id]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((s) => s.item as LibraryItem);

  return NextResponse.json({ results });
}
