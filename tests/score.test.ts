import { describe, it, expect } from "vitest";
import { normalize, dot } from "@/lib/taste";
import {
  multiHit,
  scoreCandidate,
  assembleDeck,
  mixQuotas,
  type RankedCandidate,
  type Bucket,
} from "@/lib/score";

function vec(...vals: number[]): Float32Array {
  const v = new Float32Array(8);
  vals.forEach((x, i) => (v[i] = x));
  return normalize(v);
}

describe("multi-hit boost (pixie)", () => {
  it("similar-to-many beats equally-similar-to-one", () => {
    const keeps = [vec(1, 0.2), vec(1, 0.1), vec(1, -0.1), vec(1, -0.2)];
    const broad = { id: "broad", vec: vec(1, 0) }; // close to all four
    const narrow = { id: "narrow", vec: vec(0.3, 1) }; // very close to none, kinda one
    expect(multiHit(broad, keeps)).toBeGreaterThan(multiHit(narrow, keeps));
  });
});

describe("value model", () => {
  it("anti-taste penalty is clamped at zero (v1 N3 regression)", () => {
    const anti = vec(1, 0);
    const opposite = { id: "x", vec: vec(-1, 0) }; // cos = -1 vs anti
    const neutral = { id: "y", vec: vec(0, 1) }; // cos = 0 vs anti
    const t = { facets: [], session: null, anti, last10Keeps: [] };
    // unclamped Rocchio would give `opposite` a +0.5 bonus; clamped, both get 0 penalty
    expect(scoreCandidate(opposite, t)).toBeCloseTo(scoreCandidate(neutral, t), 5);
  });

  it("exploration boost favors unjudged regions", () => {
    const c = { id: "c", vec: vec(1, 1) };
    const base = { facets: [], session: null, anti: null, last10Keeps: [] };
    const unexplored = scoreCandidate({ ...c }, { ...base, swipesNear: () => 0 });
    const wellKnown = scoreCandidate({ ...c }, { ...base, swipesNear: () => 100 });
    expect(unexplored).toBeGreaterThan(wellKnown);
  });
});

describe("deck assembly (MMR + facet diversity)", () => {
  it("never places a near-duplicate (cos>0.95) in the deck", () => {
    const a = vec(1, 0.01);
    const cands: RankedCandidate[] = [
      { id: "a", vec: a, score: 1.0 },
      { id: "a-dup", vec: vec(1, 0.02), score: 0.99 }, // cos vs a ≈ 1
      { id: "b", vec: vec(0, 1), score: 0.5 },
    ];
    const deck = assembleDeck(cands, 3);
    const ids = deck.map((d) => d.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("a-dup");
  });

  it("breaks up runs from the same facet", () => {
    // 3 high-score same-facet cards vs 1 slightly-lower other-facet card:
    // penalty should pull the other facet in before the 3rd same-facet card
    const cands: RankedCandidate[] = [
      { id: "f1-a", vec: vec(1, 0), score: 1.0, facetId: "f1" },
      { id: "f1-b", vec: vec(0.9, 0.4), score: 0.98, facetId: "f1" },
      { id: "f1-c", vec: vec(0.9, -0.4), score: 0.96, facetId: "f1" },
      { id: "f2-a", vec: vec(0, 1), score: 0.9, facetId: "f2" },
    ];
    const deck = assembleDeck(cands, 4, { mmrLambda: 0.0 }); // isolate the facet penalty
    const firstThree = deck.slice(0, 3).map((d) => d.facetId);
    expect(firstThree).toContain("f2");
  });
});

describe("mix controller", () => {
  it("served ratio converges to targets within 200 pops", () => {
    const served: Bucket[] = [];
    for (let deck = 0; deck < 20; deck++) {
      const q = mixQuotas(served, 10);
      (["exploit", "adjacent", "explore"] as Bucket[]).forEach((b) => {
        for (let i = 0; i < q[b]; i++) served.push(b);
      });
    }
    const last100 = served.slice(-100);
    const ratio = (b: Bucket) => last100.filter((x) => x === b).length / last100.length;
    expect(ratio("exploit")).toBeGreaterThan(0.5);
    expect(ratio("exploit")).toBeLessThan(0.7);
    expect(ratio("adjacent")).toBeGreaterThan(0.15);
    expect(ratio("explore")).toBeGreaterThan(0.08);
  });

  it("counter-biases when history skews exploit", () => {
    const skewed: Bucket[] = Array(100).fill("exploit");
    const q = mixQuotas(skewed, 10);
    expect(q.explore + q.adjacent).toBeGreaterThanOrEqual(5);
  });

  it("always reserves at least one explore card", () => {
    const explored: Bucket[] = Array(100).fill("explore");
    const q = mixQuotas(explored, 10);
    expect(q.explore).toBeGreaterThanOrEqual(1);
  });

  it("quotas sum to deck size", () => {
    const q = mixQuotas([], 12);
    expect(q.exploit + q.adjacent + q.explore).toBe(12);
  });
});
