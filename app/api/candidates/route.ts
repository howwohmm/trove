import { NextResponse } from "next/server";
import { getFreshPool, shuffle } from "@/lib/sources";
import { seenIds, readState } from "@/lib/store";
import { cachedEmbeddings, warmEmbeddings } from "@/lib/embeddings";
import { cosine } from "@/lib/taste";
import type { Candidate } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXPLORE_RATIO = 0.25; // share of the deck kept random, so taste keeps learning

// weave exploration cards into the ranked deck (~every 4th card)
function weave(ranked: Candidate[], explore: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  let r = 0;
  let e = 0;
  let i = 0;
  while (r < ranked.length || e < explore.length) {
    if (i % 4 === 3 && e < explore.length) out.push(explore[e++]);
    else if (r < ranked.length) out.push(ranked[r++]);
    else if (e < explore.length) out.push(explore[e++]);
    i++;
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const n = Math.min(Number(searchParams.get("n")) || 20, 50);

  const seen = await seenIds();
  const state = await readState();
  const pool = await getFreshPool(seen, 200);

  // cold start: no taste yet → shuffle, and warm the cache in the background
  if (!state.taste || state.tasteCount === 0) {
    warmEmbeddings(pool);
    return NextResponse.json({
      candidates: shuffle(pool).slice(0, n),
      ranked: false,
      tasteCount: 0,
    });
  }

  const emb = await cachedEmbeddings();
  const taste = state.taste;

  const scored = pool
    .filter((c) => emb[c.id])
    .map((c) => ({ c, score: cosine(taste, emb[c.id]) }))
    .sort((a, b) => b.score - a.score);

  const nTop = Math.max(1, Math.round(n * (1 - EXPLORE_RATIO)));
  const ranked = scored.slice(0, nTop).map((s) => s.c);
  const rankedIds = new Set(ranked.map((c) => c.id));
  const explore = shuffle(pool.filter((c) => !rankedIds.has(c.id))).slice(
    0,
    n - ranked.length
  );

  // keep warming any pool images we couldn't rank yet
  warmEmbeddings(pool.filter((c) => !emb[c.id]));

  return NextResponse.json({
    candidates: weave(ranked, explore),
    ranked: ranked.length > 0,
    tasteCount: state.tasteCount,
  });
}
