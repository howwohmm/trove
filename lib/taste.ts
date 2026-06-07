// taste vector math. vectors are unit-normalized, so cosine === dot product.

export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// running mean of liked embeddings, re-normalized to a direction.
// this IS "the algo" — each keep nudges the taste vector toward that image.
// effective-count cap so recent keeps keep moving the vector (approx recency /
// drift). without this, after hundreds of keeps each new like barely registers.
const RECENCY_WINDOW = 60;

export function runningMean(
  taste: number[] | null,
  count: number,
  vec: number[]
): number[] {
  if (!taste || count === 0) return l2normalize(vec.slice());
  const c = Math.min(count, RECENCY_WINDOW);
  const merged = taste.map((t, i) => (t * c + vec[i]) / (c + 1));
  return l2normalize(merged);
}
