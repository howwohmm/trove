// Meta-style value model + Pixie multi-hit + MMR blending + mix controller.
// Pure functions only; no IO.

import { dot, type Facet } from "@/lib/taste";

export interface Scorable {
  id: string;
  vec: Float32Array;
}

export interface TasteState {
  facets: Facet[];
  session: Float32Array | null;
  anti: Float32Array | null;
  last10Keeps: Float32Array[];
  /** swipe counts near a candidate — for the uncertainty/exploration boost */
  swipesNear?: (c: Scorable) => number;
}

export function maxFacetCos(c: Scorable, facets: Facet[]): number {
  let best = 0;
  for (const f of facets) best = Math.max(best, dot(c.vec, f.centroid));
  return best;
}

/** Pixie multi-hit: candidates resonating with SEVERAL recent keeps beat one-hit wonders */
export function multiHit(c: Scorable, last10: Float32Array[]): number {
  if (last10.length === 0) return 0;
  let s = 0;
  for (const q of last10) s += Math.sqrt(Math.max(0, dot(c.vec, q)));
  return Math.pow(s / last10.length, 2);
}

export function scoreCandidate(c: Scorable, t: TasteState, eps = 0.1): number {
  const rel =
    0.55 * maxFacetCos(c, t.facets) +
    0.25 * (t.session ? dot(c.vec, t.session) : 0) +
    0.2 * multiHit(c, t.last10Keeps);
  // clamped (v1's N3 bug: unclamped Rocchio REWARDED being opposite the dislike)
  const penalty = t.anti ? 0.5 * Math.max(0, dot(c.vec, t.anti)) : 0;
  const explore = t.swipesNear ? eps / Math.sqrt(1 + t.swipesNear(c)) : 0;
  return rel - penalty + explore;
}

export interface RankedCandidate extends Scorable {
  score: number;
  facetId?: string;
}

/**
 * MMR deck assembly with near-dup cull and escalating consecutive-facet penalty.
 * next = argmax(score − 0.3·maxSimToPicked), score ×= 0.85^k for k-th
 * consecutive same-facet card (Meta's same-author re-rank heuristic).
 */
export function assembleDeck(
  cands: RankedCandidate[],
  k: number,
  opts: { mmrLambda?: number; dupThreshold?: number; facetPenalty?: number } = {}
): RankedCandidate[] {
  const { mmrLambda = 0.3, dupThreshold = 0.95, facetPenalty = 0.85 } = opts;
  const picked: RankedCandidate[] = [];
  const remaining = [...cands];
  let lastFacet: string | undefined;
  let streak = 0;

  while (picked.length < k && remaining.length > 0) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, dot(c.vec, p.vec));
      if (maxSim > dupThreshold) continue; // near-dup cull
      let val = c.score - mmrLambda * maxSim;
      if (c.facetId && c.facetId === lastFacet) val *= Math.pow(facetPenalty, streak);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const chosen = remaining.splice(bestIdx, 1)[0];
    if (chosen.facetId && chosen.facetId === lastFacet) streak += 1;
    else streak = 1;
    lastFacet = chosen.facetId;
    picked.push(chosen);
  }
  return picked;
}

export type Bucket = "exploit" | "adjacent" | "explore";

export const MIX_TARGETS: Record<Bucket, number> = {
  exploit: 0.6,
  adjacent: 0.25,
  explore: 0.15,
};

/**
 * Proportional mix controller (Pinterest's PID idea, P-only):
 * compare served ratios over the recent window to targets, nudge quotas
 * toward target. Hard exploration floor: every deck has ≥1 explore card.
 */
export function mixQuotas(
  servedHistory: Bucket[],
  deckSize: number,
  targets: Record<Bucket, number> = MIX_TARGETS,
  gain = 0.5
): Record<Bucket, number> {
  const window = servedHistory.slice(-100);
  const buckets: Bucket[] = ["exploit", "adjacent", "explore"];
  const actual: Record<Bucket, number> = { exploit: 0, adjacent: 0, explore: 0 };
  for (const b of window) actual[b] += 1;
  const n = window.length || 1;

  const raw: Record<Bucket, number> = { exploit: 0, adjacent: 0, explore: 0 };
  for (const b of buckets) {
    const err = targets[b] - actual[b] / n;
    raw[b] = Math.max(0, targets[b] + gain * err);
  }
  const sum = raw.exploit + raw.adjacent + raw.explore;
  const out: Record<Bucket, number> = { exploit: 0, adjacent: 0, explore: 0 };
  let assigned = 0;
  for (const b of buckets) {
    out[b] = Math.round((raw[b] / sum) * deckSize);
    assigned += out[b];
  }
  // fix rounding drift on the largest bucket
  out.exploit += deckSize - assigned;
  // exploration floor
  if (out.explore === 0 && deckSize >= 3) {
    out.explore = 1;
    out.exploit = Math.max(0, out.exploit - 1);
  }
  return out;
}
