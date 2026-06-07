import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/store";
import { cachedEmbeddings } from "@/lib/embeddings";
import { getFacets } from "@/lib/facets";
import { pca2 } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function GET() {
  const [library, emb, facets] = await Promise.all([getLibrary(), cachedEmbeddings(), getFacets()]);

  // which facet each image belongs to (for coloring/labels)
  const facetOf: Record<string, string> = {};
  facets.forEach((f, i) => {
    for (const id of f.memberIds) facetOf[id] = f.label || `facet ${i + 1}`;
  });

  // only images we have embeddings for can be positioned
  const items = library.filter((l) => emb[l.id]);
  const points = pca2(items.map((l) => emb[l.id]));

  const nodes = items.map((l, i) => ({
    id: l.id,
    url: l.url,
    file: l.file,
    x: points[i]?.x ?? 0.5,
    y: points[i]?.y ?? 0.5,
    facet: facetOf[l.id] ?? null,
  }));

  return NextResponse.json({ nodes, facets: facets.map((f) => f.label), total: library.length });
}
