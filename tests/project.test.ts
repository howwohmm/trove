import { describe, it, expect } from "vitest";
import { pca2 } from "../lib/project";

const vectors = [
  [1, 0, 0, 0, 0, 0],
  [0.9, 0.1, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0],
  [0, 0.9, 0.1, 0, 0, 0],
  [0, 0, 1, 0, 0, 0],
  [0.2, 0.2, 0.8, 0, 0, 0],
];

describe("pca2", () => {
  it("returns one point per input vector", () => {
    const pts = pca2(vectors);
    expect(pts.length).toBe(vectors.length);
  });

  it("returns an empty array for empty input", () => {
    expect(pca2([])).toEqual([]);
  });

  it("all coordinates lie within [0, 1]", () => {
    const pts = pca2(vectors);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across two calls (stable layout)", () => {
    const a = pca2(vectors);
    const b = pca2(vectors);
    expect(a).toEqual(b);
  });
});
