import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/store";
import { cachedEmbeddings } from "@/lib/embeddings";
import { getFacets } from "@/lib/facets";
import { cosine } from "@/lib/taste";
import type { LibraryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// your taste, made visible: each facet with its anchor images (the members
// closest to the facet centroid — the "you're seeing this because it's near THIS").
export async function GET() {
  const [facets, lib, emb] = await Promise.all([getFacets(), getLibrary(), cachedEmbeddings()]);
  const byId = new Map(lib.map((l) => [l.id, l] as const));

  const result = facets.map((f) => {
    const members = f.memberIds
      .map((id) => ({ item: byId.get(id), v: emb[id] }))
      .filter((m): m is { item: LibraryItem; v: number[] } => !!m.item && !!m.v)
      .map((m) => ({ ...m, s: cosine(f.centroid, m.v) }))
      .sort((a, b) => b.s - a.s);
    return {
      id: f.id,
      label: f.label,
      size: f.size,
      queries: f.queries,
      anchors: members.slice(0, 6).map((m) => ({ url: m.item.url, file: m.item.file })),
    };
  });

  return NextResponse.json({ facets: result });
}
