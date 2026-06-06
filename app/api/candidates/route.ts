import { NextResponse } from "next/server";
import { getFreshPool, shuffle } from "@/lib/sources";
import { addToCorpus, getCorpus } from "@/lib/corpus";
import { seenIds, readState } from "@/lib/store";
import { cachedEmbeddings, warmEmbeddings } from "@/lib/embeddings";
import { getFacets } from "@/lib/facets";
import { tasteScore, dislikeCentroid, mmrRerank, type Scored } from "@/lib/rec";
import type { Candidate } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXPLORE_RATIO = 0.25;
const MMR_INPUT_CAP = 80; // rerank only the top-scored slice (MMR is O(k·n))

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
  const facetId = searchParams.get("facet") || undefined;

  const seen = await seenIds();
  const state = await readState();
  const facets = await getFacets();
  const activeFacet = facetId ? facets.find((f) => f.id === facetId) : undefined;

  // retrieval: query the source for taste-relevant images, persist to the corpus
  const queries = activeFacet
    ? activeFacet.queries
    : facets.length
      ? [...new Set(facets.flatMap((f) => f.queries))].slice(0, 6)
      : undefined;
  const fresh = await getFreshPool(seen, 100, queries ? { queries } : undefined);
  await addToCorpus(fresh);

  const emb = await cachedEmbeddings();
  const corpus = await getCorpus();
  const pool = corpus.filter((c) => !seen.has(c.id));

  // rank the whole accumulated corpus (only items we've embedded)
  const facetsForScore = activeFacet ? [activeFacet] : facets;
  const haveTaste = facetsForScore.length > 0 || !!state.taste;

  // dislike centroid from recently-skipped images that happen to be embedded
  const skipped = state.swipes
    .filter((s) => s.dir === "skip")
    .slice(-100)
    .map((s) => emb[s.id])
    .filter(Boolean) as number[][];
  const dislike = dislikeCentroid(skipped);

  const rankable: Scored[] = haveTaste
    ? pool
        .filter((c) => emb[c.id])
        .map((c) => ({
          c,
          emb: emb[c.id],
          score: tasteScore(emb[c.id], facetsForScore, state.taste, dislike),
        }))
    : [];

  // cold start / nothing embedded yet → shuffle fresh, warm in background
  if (rankable.length === 0) {
    warmEmbeddings(pool.slice(0, 40));
    return NextResponse.json({
      candidates: shuffle(fresh).slice(0, n),
      ranked: false,
      tasteCount: state.tasteCount,
      facet: activeFacet?.label ?? null,
    });
  }

  const nTop = Math.max(1, Math.round(n * (1 - EXPLORE_RATIO)));
  const topInput = rankable.sort((a, b) => b.score - a.score).slice(0, MMR_INPUT_CAP);
  const ranked = mmrRerank(topInput, nTop, 0.7);
  const rankedIds = new Set(ranked.map((c) => c.id));
  const explore = shuffle(pool.filter((c) => !rankedIds.has(c.id))).slice(0, n - ranked.length);

  // keep warming the corpus so the rankable pool grows
  warmEmbeddings(pool.filter((c) => !emb[c.id]).slice(0, 16));

  return NextResponse.json({
    candidates: weave(ranked, explore),
    ranked: true,
    tasteCount: state.tasteCount,
    facet: activeFacet?.label ?? null,
  });
}
