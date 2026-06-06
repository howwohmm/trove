import { NextResponse } from "next/server";
import { getUnsplashRate } from "@/lib/sources";
import { getCorpus } from "@/lib/corpus";
import { cachedEmbeddings } from "@/lib/embeddings";
import { readState } from "@/lib/store";
import { getFacets } from "@/lib/facets";
import { getDreams } from "@/lib/dreams";
import { hasClaude } from "@/lib/claude";
import { providerLabel, activeProvider } from "@/lib/generate";

export const dynamic = "force-dynamic";

// openrouter credits — this metadata call is free / doesn't spend credits
async function openrouterCredits() {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      data?: { usage?: number; limit?: number | null; limit_remaining?: number | null };
    };
    return {
      usage: d.data?.usage ?? null,
      limit: d.data?.limit ?? null,
      remaining: d.data?.limit_remaining ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const [corpus, emb, state, facets, dreams, orCredits] = await Promise.all([
    getCorpus(),
    cachedEmbeddings(),
    readState(),
    getFacets(),
    getDreams(),
    openrouterCredits(),
  ]);

  const rate = getUnsplashRate();
  const pending = dreams.filter((d) => !d.status || d.status === "pending").length;
  const kept = dreams.filter((d) => d.status === "kept").length;

  // exploit-vs-explore proof signal: keep-rate over recent swipes
  const swipes = state.swipes;
  const recent = swipes.slice(-50);
  const keepRate = recent.length
    ? recent.filter((s) => s.dir === "like").length / recent.length
    : 0;

  return NextResponse.json({
    sources: {
      unsplash: rate
        ? { remaining: rate.remaining, limit: rate.limit, ageSec: Math.round((Date.now() - rate.at) / 1000) }
        : null,
    },
    generation: {
      claude: hasClaude(),
      imageProvider: providerLabel(),
      hasImageProvider: activeProvider() !== "none",
      openrouter: orCredits,
    },
    taste: {
      keeps: state.tasteCount,
      facets: facets.map((f) => ({ label: f.label, size: f.size })),
      keepRate: Math.round(keepRate * 100),
    },
    pool: {
      corpus: corpus.length,
      embedded: Object.keys(emb).length,
      swipes: swipes.length,
    },
    dreams: { pending, kept, total: dreams.length },
  });
}
