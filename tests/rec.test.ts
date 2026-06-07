import { describe, it, expect } from "vitest";
import {
  meanVec,
  tasteScore,
  dislikeCentroid,
  mmrRerank,
  type Scored,
} from "../lib/rec";
import { l2normalize } from "../lib/taste";
import type { Facet } from "../lib/facets";
import type { Candidate } from "../lib/types";

// --- small helpers -----------------------------------------------------------

function facet(centroid: number[], size: number, id = "f"): Facet {
  return {
    id,
    label: id,
    queries: [],
    centroid: l2normalize(centroid),
    memberIds: [],
    size,
  };
}

function candidate(id: string): Candidate {
  return {
    id,
    url: `u/${id}`,
    downloadUrl: `d/${id}`,
    width: 100,
    height: 100,
    source: "picsum",
  };
}

// --- meanVec -----------------------------------------------------------------

describe("meanVec", () => {
  it("averages componentwise", () => {
    const out = meanVec([
      [0, 0, 0, 0],
      [2, 4, 6, 8],
    ]);
    expect(out).toEqual([1, 2, 3, 4]);
  });
});

// --- tasteScore --------------------------------------------------------------

describe("tasteScore", () => {
  it("a candidate closer to the centroid scores higher", () => {
    const f = [facet([1, 0, 0, 0], 20)];
    const near = l2normalize([1, 0.1, 0, 0]);
    const far = l2normalize([0, 1, 0, 0]);
    const sNear = tasteScore(near, f, null, null);
    const sFar = tasteScore(far, f, null, null);
    expect(sNear).toBeGreaterThan(sFar);
  });

  it("falls back to the single taste vector when there are no facets", () => {
    const taste = l2normalize([1, 0, 0, 0]);
    const near = l2normalize([1, 0.1, 0, 0]);
    const score = tasteScore(near, [], taste, null);
    expect(score).toBeCloseTo(cosineRef(taste, near), 10);
  });

  it("returns 0 with no facets and no fallback taste", () => {
    expect(tasteScore([1, 0, 0, 0], [], null, null)).toBe(0);
  });

  it("a size-1 facet loses to an equally-close size-20 facet (shrinkage)", () => {
    const emb = l2normalize([1, 0, 0, 0]);
    // both facets sit exactly on the candidate direction, so raw cosine is equal.
    const small = [facet([1, 0, 0, 0], 1, "small")];
    const big = [facet([1, 0, 0, 0], 20, "big")];
    const sSmall = tasteScore(emb, small, null, null);
    const sBig = tasteScore(emb, big, null, null);
    // shrinkage size/(size+3): 1/4 = 0.25 vs 20/23 ~ 0.87
    expect(sBig).toBeGreaterThan(sSmall);
    expect(sSmall).toBeCloseTo(0.25, 6);
    expect(sBig).toBeCloseTo(20 / 23, 6);
  });

  it("a non-null dislike near the candidate lowers the score", () => {
    const f = [facet([1, 0, 0, 0], 20)];
    const emb = l2normalize([1, 0, 0, 0]);
    const withoutDislike = tasteScore(emb, f, null, null);
    const dislike = l2normalize([1, 0, 0, 0]); // points right at the candidate
    const withDislike = tasteScore(emb, f, null, dislike);
    expect(withDislike).toBeLessThan(withoutDislike);
  });
});

// small local cosine for the fallback assertion (avoid importing twice noise)
function cosineRef(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// --- dislikeCentroid ---------------------------------------------------------

describe("dislikeCentroid", () => {
  it("returns null for fewer than 5 vectors", () => {
    const vecs = Array.from({ length: 4 }, () => l2normalize([1, 0, 0, 0]));
    expect(dislikeCentroid(vecs)).toBeNull();
  });

  it("returns a unit vector for 5 or more vectors", () => {
    const vecs = Array.from({ length: 5 }, (_, i) =>
      l2normalize([1, i % 2, 0, 0])
    );
    const out = dislikeCentroid(vecs);
    expect(out).not.toBeNull();
    const n = Math.sqrt(out!.reduce((s, x) => s + x * x, 0));
    expect(n).toBeCloseTo(1, 10);
  });
});

// --- mmrRerank ---------------------------------------------------------------

describe("mmrRerank", () => {
  it("returns exactly k items", () => {
    const scored: Scored[] = [
      { c: candidate("a"), emb: l2normalize([1, 0, 0, 0]), score: 0.9 },
      { c: candidate("b"), emb: l2normalize([0, 1, 0, 0]), score: 0.8 },
      { c: candidate("c"), emb: l2normalize([0, 0, 1, 0]), score: 0.7 },
      { c: candidate("d"), emb: l2normalize([0, 0, 0, 1]), score: 0.6 },
    ];
    expect(mmrRerank(scored, 2).length).toBe(2);
    expect(mmrRerank(scored, 4).length).toBe(4);
  });

  it("does not return more than the pool size when k exceeds it", () => {
    const scored: Scored[] = [
      { c: candidate("a"), emb: l2normalize([1, 0, 0, 0]), score: 0.9 },
    ];
    expect(mmrRerank(scored, 5).length).toBe(1);
  });

  it("two near-identical embeddings (cosine > 0.93) are not both near the top", () => {
    // a and a2 are near-dups; b and c are distinct directions.
    const a = l2normalize([1, 0.02, 0, 0]);
    const a2 = l2normalize([1, 0.01, 0, 0]); // cosine(a,a2) > 0.93
    expect(cosineRef(a, a2)).toBeGreaterThan(0.93);
    const scored: Scored[] = [
      { c: candidate("a"), emb: a, score: 0.95 },
      { c: candidate("a2"), emb: a2, score: 0.94 }, // would be #2 by score alone
      { c: candidate("b"), emb: l2normalize([0, 1, 0, 0]), score: 0.5 },
      { c: candidate("c"), emb: l2normalize([0, 0, 1, 0]), score: 0.4 },
    ];
    const out = mmrRerank(scored, 4, 0.7).map((c) => c.id);
    // best-scoring near-dup leads; its twin must be deferred past a diverse pick.
    expect(out[0]).toBe("a");
    expect(out.indexOf("a2")).toBeGreaterThan(out.indexOf("b"));
  });
});
