// PinnerSage-lite: the user is never one vector — they're a set of
// (facet medoid, importance) pairs from Ward-clustered kept-image embeddings.
// Pure functions only; no IO. All vectors unit-normalized => cosine = dot.

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export interface Item {
  id: string;
  vec: Float32Array;
}

/**
 * Agglomerative clustering with Ward linkage (Lance-Williams update),
 * cut at merge-distance threshold `alpha` => cluster count is automatic.
 * O(m^2) memory, ~O(m^2 log m) time — fine to a few thousand keeps;
 * we recluster every 5 keeps so m grows slowly.
 * Initial d^2 between unit vectors = ||a-b||^2 = 2 - 2cos ∈ [0,4].
 */
export function wardCluster(items: Item[], alpha: number): string[][] {
  const m = items.length;
  if (m === 0) return [];
  if (m === 1) return [[items[0].id]];

  // active cluster bookkeeping
  const size: number[] = new Array(m).fill(1);
  const members: number[][] = items.map((_, i) => [i]);
  const active = new Set<number>(items.map((_, i) => i));

  // distance matrix (squared euclidean, Ward objective)
  const d: number[][] = [];
  for (let i = 0; i < m; i++) d.push(new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const dist = 2 - 2 * dot(items[i].vec, items[j].vec);
      d[i][j] = dist;
      d[j][i] = dist;
    }
  }

  const alpha2 = alpha * alpha; // callers pass alpha in distance terms; ward works on squared

  while (active.size > 1) {
    // find closest pair
    let bi = -1,
      bj = -1,
      best = Infinity;
    const act = [...active];
    for (let x = 0; x < act.length; x++) {
      for (let y = x + 1; y < act.length; y++) {
        const i = act[x],
          j = act[y];
        if (d[i][j] < best) {
          best = d[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (best > alpha2) break; // dendrogram cut

    // merge bj into bi via Lance-Williams (Ward)
    const ni = size[bi],
      nj = size[bj];
    for (const k of active) {
      if (k === bi || k === bj) continue;
      const nk = size[k];
      d[bi][k] = d[k][bi] =
        ((ni + nk) * d[bi][k] + (nj + nk) * d[bj][k] - nk * d[bi][bj]) / (ni + nj + nk);
    }
    size[bi] = ni + nj;
    members[bi] = members[bi].concat(members[bj]);
    active.delete(bj);
  }

  return [...active].map((i) => members[i].map((idx) => items[idx].id));
}

/** the most central REAL member — interpretable, cacheable, outlier-robust */
export function medoidOf(items: Item[]): string {
  let bestId = items[0].id;
  let bestSum = -Infinity;
  for (const a of items) {
    let s = 0;
    for (const b of items) s += dot(a.vec, b.vec);
    if (s > bestSum) {
      bestSum = s;
      bestId = a.id;
    }
  }
  return bestId;
}

export function centroidOf(items: Item[]): Float32Array {
  const dim = items[0].vec.length;
  const c = new Float32Array(dim);
  for (const it of items) for (let i = 0; i < dim; i++) c[i] += it.vec[i];
  return normalize(c);
}

/** PinnerSage importance: Σ e^(−λ·days_since), λ=0.01 — frequent AND recent wins */
export function importanceOf(swipeTimesMs: number[], nowMs: number, lambda = 0.01): number {
  let s = 0;
  for (const t of swipeTimesMs) s += Math.exp((-lambda * (nowMs - t)) / 86400000);
  return s;
}

/**
 * Stable facet ids: greedily match new centroids to previous facets by
 * cosine (> 0.8), best matches first; unmatched clusters get freshId().
 * Fixes v1's reshuffling-facets bug (M2).
 */
export function matchFacetIds(
  prev: { id: string; centroid: Float32Array }[],
  nextCentroids: Float32Array[],
  freshId: () => string
): string[] {
  const pairs: { p: number; n: number; sim: number }[] = [];
  for (let p = 0; p < prev.length; p++)
    for (let n = 0; n < nextCentroids.length; n++)
      pairs.push({ p, n, sim: dot(prev[p].centroid, nextCentroids[n]) });
  pairs.sort((a, b) => b.sim - a.sim);
  const usedP = new Set<number>();
  const out: (string | null)[] = new Array(nextCentroids.length).fill(null);
  for (const { p, n, sim } of pairs) {
    if (sim < 0.8) break;
    if (usedP.has(p) || out[n]) continue;
    usedP.add(p);
    out[n] = prev[p].id;
  }
  return out.map((id) => id ?? freshId());
}

/**
 * Anti-taste: weighted decayed mean of skip embeddings.
 * Fast-left (<1200ms dwell) = strong "see less" (w=1.0), slow-left = weak (w=0.4).
 * 14-day half-life => penalties DECAY, never permanent (Meta's "show less" is temporary).
 */
export function antiTasteVec(
  skips: { vec: Float32Array; dwellMs: number; at: number }[],
  nowMs: number
): Float32Array | null {
  if (skips.length === 0) return null;
  const dim = skips[0].vec.length;
  const acc = new Float32Array(dim);
  const halfLifeMs = 14 * 86400000;
  for (const s of skips) {
    const strength = s.dwellMs < 1200 ? 1.0 : 0.4;
    const decay = Math.pow(0.5, (nowMs - s.at) / halfLifeMs);
    const w = strength * decay;
    for (let i = 0; i < dim; i++) acc[i] += w * s.vec[i];
  }
  return normalize(acc);
}

/** short-term taste: decayed mean of last ~10 keeps, newest first, weight 0.8^i */
export function sessionVec(recentKeepVecs: Float32Array[]): Float32Array | null {
  if (recentKeepVecs.length === 0) return null;
  const dim = recentKeepVecs[0].length;
  const acc = new Float32Array(dim);
  recentKeepVecs.slice(0, 10).forEach((v, i) => {
    const w = Math.pow(0.8, i);
    for (let j = 0; j < dim; j++) acc[j] += w * v[j];
  });
  return normalize(acc);
}

export interface Facet {
  id: string;
  medoidId: string;
  centroid: Float32Array;
  memberIds: string[];
  importance: number;
}

/**
 * Full facet computation: ward → medoid/centroid per cluster → stable ids →
 * importance from each member's swipe times.
 */
export function computeFacets(
  keeps: Item[],
  swipeTimesByImage: Map<string, number[]>,
  prevFacets: { id: string; centroid: Float32Array }[],
  freshId: () => string,
  nowMs: number,
  // calibrated on the imported v1 library (401 keeps): 1.6 => 11 balanced facets
  alpha = 1.6
): Facet[] {
  if (keeps.length === 0) return [];
  const groups = wardCluster(keeps, alpha);
  const byId = new Map(keeps.map((k) => [k.id, k]));
  const built = groups.map((ids) => {
    const members = ids.map((id) => byId.get(id)!);
    return {
      memberIds: ids,
      centroid: centroidOf(members),
      medoidId: medoidOf(members),
    };
  });
  const ids = matchFacetIds(prevFacets, built.map((b) => b.centroid), freshId);
  return built.map((b, i) => ({
    id: ids[i],
    ...b,
    importance: importanceOf(
      b.memberIds.flatMap((id) => swipeTimesByImage.get(id) ?? []),
      nowMs
    ),
  }));
}
