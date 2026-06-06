// auto facets: cluster your kept images (CLIP embeddings) into taste groups,
// then have Claude name each one + give search keywords. these facets ARE the
// categories, the multi-interest recommendation model, and the retrieval queries.

import { getLibrary } from "./store";
import { getEmbedding } from "./embeddings";
import { hasClaude, labelFacet } from "./claude";
import { getMeta, setMeta } from "./db";

const RECOMPUTE_DELTA = 5; // recompute after this many new keeps
const MIN_TO_CLUSTER = 6;

export interface Facet {
  id: string;
  label: string;
  queries: string[]; // keywords to retrieve more images like this facet
  centroid: number[];
  memberIds: string[];
  size: number;
}

interface FacetStore {
  facets: Facet[];
  count: number; // library size when last computed
}

let computing = false;

function load(): FacetStore {
  const raw = getMeta("facets");
  if (!raw) return { facets: [], count: 0 };
  try {
    return JSON.parse(raw) as FacetStore;
  } catch {
    return { facets: [], count: 0 };
  }
}

function persist(store: FacetStore): void {
  setMeta("facets", JSON.stringify(store));
}

export async function getFacets(): Promise<Facet[]> {
  return load().facets;
}

// ---- k-means (embeddings are unit-normalized, so squared-euclidean ranks like cosine)
function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}
function meanVec(vs: number[][]): number[] {
  const d = vs[0].length;
  const c = new Array(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) c[i] += v[i];
  for (let i = 0; i < d; i++) c[i] /= vs.length;
  return c;
}
function l2(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}
function kmeans(vectors: number[][], k: number, iters = 15) {
  k = Math.min(k, vectors.length);
  const idx = vectors.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let centroids = idx.slice(0, k).map((i) => vectors[i].slice());
  const assign = new Array(vectors.length).fill(0);
  for (let it = 0; it < iters; it++) {
    for (let n = 0; n < vectors.length; n++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(vectors[n], centroids[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[n] = best;
    }
    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, n) => assign[n] === c);
      if (members.length) centroids[c] = meanVec(members);
    }
  }
  return { centroids: centroids.map(l2), assign };
}

export async function computeFacets(): Promise<void> {
  if (computing) return;
  computing = true;
  try {
    const lib = await getLibrary();
    if (lib.length < MIN_TO_CLUSTER) return;

    const items: typeof lib = [];
    const vectors: number[][] = [];
    for (const it of lib) {
      try {
        vectors.push(await getEmbedding(it.id, it.url));
        items.push(it);
      } catch {
        // skip un-embeddable
      }
    }
    if (vectors.length < MIN_TO_CLUSTER) return;

    const k = Math.max(2, Math.min(6, Math.round(vectors.length / 9)));
    const { centroids, assign } = kmeans(vectors, k);

    const facets: Facet[] = [];
    for (let c = 0; c < centroids.length; c++) {
      const memberIdxs = assign
        .map((a, i) => (a === c ? i : -1))
        .filter((i) => i >= 0);
      if (!memberIdxs.length) continue;
      // representative images = closest to the centroid
      const reps = memberIdxs
        .map((i) => ({ i, d: dist2(vectors[i], centroids[c]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((x) => items[x.i].url);

      let label = `facet ${c + 1}`;
      let queries: string[] = [];
      if (hasClaude()) {
        const r = await labelFacet(reps);
        if (r) {
          label = r.label;
          queries = r.queries;
        }
      }
      facets.push({
        id: `facet-${c + 1}`,
        label,
        queries,
        centroid: centroids[c],
        memberIds: memberIdxs.map((i) => items[i].id),
        size: memberIdxs.length,
      });
    }
    facets.sort((a, b) => b.size - a.size);
    persist({ facets, count: lib.length });
  } finally {
    computing = false;
  }
}

// background recompute when the library has grown enough (or no facets yet)
export function scheduleFacets(): void {
  void (async () => {
    if (computing) return;
    const store = load();
    const lib = await getLibrary();
    if (
      lib.length >= MIN_TO_CLUSTER &&
      (store.facets.length === 0 || lib.length >= store.count + RECOMPUTE_DELTA)
    ) {
      await computeFacets();
    }
  })().catch(() => {});
}
