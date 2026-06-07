import { describe, it, expect } from "vitest";
import { l2normalize, cosine, runningMean } from "../lib/taste";

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

describe("l2normalize", () => {
  it("returns a unit vector", () => {
    const out = l2normalize([3, 4, 0, 0]);
    expect(norm(out)).toBeCloseTo(1, 10);
  });

  it("preserves direction", () => {
    const out = l2normalize([2, 0, 0, 0]);
    expect(out[0]).toBeCloseTo(1, 10);
  });

  it("handles a zero vector without NaN", () => {
    const out = l2normalize([0, 0, 0, 0]);
    expect(out.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("cosine", () => {
  it("identical unit vectors -> ~1", () => {
    const a = l2normalize([1, 2, 3, 4]);
    expect(cosine(a, a)).toBeCloseTo(1, 10);
  });

  it("orthogonal vectors -> ~0", () => {
    const a = l2normalize([1, 0, 0, 0]);
    const b = l2normalize([0, 1, 0, 0]);
    expect(cosine(a, b)).toBeCloseTo(0, 10);
  });

  it("opposite vectors -> ~-1", () => {
    const a = l2normalize([1, 1, 0, 0]);
    const b = l2normalize([-1, -1, 0, 0]);
    expect(cosine(a, b)).toBeCloseTo(-1, 10);
  });
});

describe("runningMean", () => {
  it("first call (null taste) returns the unit-normalized input vec", () => {
    const out = runningMean(null, 0, [3, 4, 0, 0]);
    expect(norm(out)).toBeCloseTo(1, 10);
    // direction matches input
    const expected = l2normalize([3, 4, 0, 0]);
    out.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 10));
  });

  it("count 0 also normalizes the fresh vec regardless of taste arg", () => {
    const out = runningMean([1, 0, 0, 0], 0, [0, 5, 0, 0]);
    const expected = l2normalize([0, 5, 0, 0]);
    out.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 10));
  });

  it("incremental mean is correct and stays unit-norm", () => {
    // taste is a unit vector along x; fold in a vector along y with count=1.
    // merged (pre-norm) = (taste*1 + vec)/2 = ([1,0,0,0] + [0,1,0,0])/2
    //                   = [0.5, 0.5, 0, 0]  ->  normalized to [√.5, √.5, 0, 0]
    const taste = l2normalize([1, 0, 0, 0]);
    const out = runningMean(taste, 1, [0, 1, 0, 0]);
    expect(norm(out)).toBeCloseTo(1, 10);
    expect(out[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("higher count pulls the result less toward the new vec than a low count", () => {
    const taste = l2normalize([1, 0, 0, 0]);
    const fresh = [0, 1, 0, 0];
    const lowCount = runningMean(taste, 1, fresh); // big nudge
    const highCount = runningMean(taste, 50, fresh); // small nudge
    // the y-component (toward the new vec) is larger for the low count
    expect(lowCount[1]).toBeGreaterThan(highCount[1]);
  });

  it("at/above RECENCY_WINDOW (60) a fresh vec still moves the result meaningfully (not frozen)", () => {
    const taste = l2normalize([1, 0, 0, 0]);
    const fresh = [0, 1, 0, 0];
    // count capped at 60: merged = (taste*60 + fresh)/61 -> y = 1/61 pre-norm,
    // which after normalization is ~0.0164 — small but clearly nonzero & finite.
    const out = runningMean(taste, 1000, fresh);
    expect(norm(out)).toBeCloseTo(1, 10);
    expect(out[1]).toBeGreaterThan(0.01);
    // and the cap means count=1000 behaves identically to count=60
    const at60 = runningMean(taste, 60, fresh);
    out.forEach((x, i) => expect(x).toBeCloseTo(at60[i], 10));
  });
});
