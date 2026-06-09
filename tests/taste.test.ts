import { describe, it, expect } from "vitest";
import {
  wardCluster,
  medoidOf,
  centroidOf,
  importanceOf,
  matchFacetIds,
  antiTasteVec,
  sessionVec,
  normalize,
  dot,
} from "@/lib/taste";

function vec(...seed: number[]): Float32Array {
  // deterministic 8-dim unit vector; distinct seeds (mod 8) => well-separated directions
  const v = new Float32Array(8);
  v[seed[0] % 8] = 1;
  v[(seed[0] * 5 + 3) % 8] += 0.35 + 0.1 * (seed[1] ?? 0);
  return normalize(v);
}

function blob(center: number, n: number, jitter = 0.05): { id: string; vec: Float32Array }[] {
  return Array.from({ length: n }, (_, i) => {
    const v = new Float32Array(8);
    const c = vec(center, 0);
    for (let j = 0; j < 8; j++) v[j] = c[j] + jitter * Math.sin(i * 7.3 + j);
    return { id: `b${center}-${i}`, vec: normalize(v) };
  });
}

describe("ward clustering", () => {
  it("separates two well-separated blobs into two clusters", () => {
    const items = [...blob(1, 6), ...blob(4, 6)];
    const groups = wardCluster(items, 0.5);
    expect(groups.length).toBe(2);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes).toEqual([6, 6]);
  });

  it("auto-k: three blobs give three clusters, no k to tune", () => {
    const items = [...blob(1, 5), ...blob(4, 5), ...blob(6, 5)];
    const groups = wardCluster(items, 0.5);
    expect(groups.length).toBe(3);
  });

  it("one tight blob stays one cluster", () => {
    const groups = wardCluster(blob(3, 10, 0.02), 0.5);
    expect(groups.length).toBe(1);
  });
});

describe("medoid + centroid", () => {
  it("medoid is a real member, the most central one", () => {
    const items = blob(2, 7);
    const m = medoidOf(items);
    expect(items.some((i) => i.id === m)).toBe(true);
    // the medoid should have max average similarity to others
    const c = centroidOf(items);
    const mVec = items.find((i) => i.id === m)!.vec;
    const best = Math.max(...items.map((i) => dot(i.vec, c)));
    expect(dot(mVec, c)).toBeCloseTo(best, 5);
  });
});

describe("importance decay (λ=0.01/day)", () => {
  it("a swipe today counts ~1, a swipe 100 days ago counts ~e^-1", () => {
    const now = Date.now();
    const day = 86400000;
    expect(importanceOf([now], now)).toBeCloseTo(1, 3);
    expect(importanceOf([now - 100 * day], now)).toBeCloseTo(Math.exp(-1), 2);
  });
  it("frequent AND recent beats frequent-old", () => {
    const now = Date.now();
    const day = 86400000;
    const recent = importanceOf([now, now - day, now - 2 * day], now);
    const old = importanceOf([now - 200 * day, now - 201 * day, now - 202 * day], now);
    expect(recent).toBeGreaterThan(old);
  });
});

describe("stable facet ids", () => {
  it("keeps ids across recompute when centroids barely move", () => {
    const a = blob(1, 6);
    const b = blob(4, 6);
    const prev = [
      { id: "f1", centroid: centroidOf(a) },
      { id: "f2", centroid: centroidOf(b) },
    ];
    // recompute with one extra member in each — centroids shift slightly
    const next = [centroidOf([...b, ...blob(4, 1)]), centroidOf([...a, ...blob(1, 1)])];
    const ids = matchFacetIds(prev, next, () => "fresh");
    expect(ids[0]).toBe("f2");
    expect(ids[1]).toBe("f1");
  });
  it("a genuinely new cluster gets a fresh id", () => {
    const prev = [{ id: "f1", centroid: centroidOf(blob(1, 5)) }];
    const ids = matchFacetIds(prev, [centroidOf(blob(1, 5)), centroidOf(blob(6, 5))], () => "fresh");
    expect(ids[0]).toBe("f1");
    expect(ids[1]).toBe("fresh");
  });
});

describe("anti-taste", () => {
  it("fast skips weigh more than slow skips", () => {
    const now = Date.now();
    const a = vec(5, 0);
    const b = vec(11, 0);
    const anti = antiTasteVec(
      [
        { vec: a, dwellMs: 300, at: now },   // fast-left: strong signal
        { vec: b, dwellMs: 4000, at: now },  // slow-left: weak
      ],
      now
    )!;
    expect(dot(anti, a)).toBeGreaterThan(dot(anti, b));
  });
  it("old skips decay away (14d half-life)", () => {
    const now = Date.now();
    const day = 86400000;
    const a = vec(5, 0);
    const b = vec(11, 0);
    const anti = antiTasteVec(
      [
        { vec: a, dwellMs: 300, at: now - 70 * day }, // 5 half-lives ago
        { vec: b, dwellMs: 300, at: now },
      ],
      now
    )!;
    expect(dot(anti, b)).toBeGreaterThan(dot(anti, a));
  });
  it("returns null with no skips", () => {
    expect(antiTasteVec([], Date.now())).toBeNull();
  });
});

describe("session vector", () => {
  it("weights the latest keep highest (0.8^i)", () => {
    const newest = vec(2, 0);
    const oldest = vec(17, 0);
    const s = sessionVec([newest, oldest])!; // index 0 = newest
    expect(dot(s, newest)).toBeGreaterThan(dot(s, oldest));
  });
});
