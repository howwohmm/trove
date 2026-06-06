// the recommendation engine. multi-prototype taste (max over facet centroids,
// shrinkage), Rocchio negatives, and MMR diversity rerank. all plain vector math.
// (architecture per specs/recommendation-engine.html)

import { cosine, l2normalize } from "./taste";
import type { Candidate } from "./types";
import type { Facet } from "./facets";

const SHRINK = 3; // immature facets trusted less: size/(size+SHRINK)
const NEG_WEIGHT = 0.3; // Rocchio gamma — negatives subordinate to positives
const DUP_SIM = 0.93; // candidates this similar to a picked one are near-dups

export function meanVec(vs: number[][]): number[] {
  const d = vs[0].length;
  const c = new Array(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) c[i] += v[i];
  for (let i = 0; i < d; i++) c[i] /= vs.length;
  return c;
}

// multi-interest score: best-matching facet (shrunk by maturity) minus dislike.
// falls back to the single taste vector when facets aren't built yet.
export function tasteScore(
  emb: number[],
  facets: Facet[],
  fallbackTaste: number[] | null,
  dislike: number[] | null
): number {
  let pos: number;
  if (facets.length) {
    pos = Math.max(
      ...facets.map((f) => cosine(f.centroid, emb) * (f.size / (f.size + SHRINK)))
    );
  } else if (fallbackTaste) {
    pos = cosine(fallbackTaste, emb);
  } else {
    return 0;
  }
  const neg = dislike ? NEG_WEIGHT * cosine(dislike, emb) : 0;
  return pos - neg;
}

// dislike centroid from the embeddings of recently-skipped images (cached only;
// we don't embed skips on purpose). null until we have enough signal.
export function dislikeCentroid(skipVecs: number[][]): number[] | null {
  if (skipVecs.length < 5) return null;
  return l2normalize(meanVec(skipVecs));
}

export interface Scored {
  c: Candidate;
  emb: number[];
  score: number;
}

// greedy MMR rerank: λ·relevance − (1−λ)·maxSimToPicked, near-dups pushed last.
export function mmrRerank(scored: Scored[], k: number, lambda = 0.7): Candidate[] {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const picked: Scored[] = [];
  while (picked.length < k && pool.length) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const p of picked) {
        const s = cosine(pool[i].emb, p.emb);
        if (s > maxSim) maxSim = s;
      }
      const mmr =
        maxSim > DUP_SIM
          ? -Infinity // near-dup of something already shown → defer
          : lambda * pool[i].score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked.map((p) => p.c);
}
