// project high-dim CLIP embeddings → 2D for the taste map. PCA via power
// iteration (deterministic init → stable layout across reloads). similar images
// land near each other, so the map reads as clusters of your taste.

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function normalize(v: number[]): void {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
}

export interface Point {
  x: number;
  y: number;
}

export function pca2(vectors: number[][]): Point[] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0].length;

  // mean-center
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]));

  // top principal component via power iteration on covariance (XᵀX), optionally
  // deflated against an earlier component
  const topPC = (exclude?: number[]): number[] => {
    let p = new Array(d).fill(0).map((_, i) => Math.sin(i * 0.7 + 1)); // deterministic
    normalize(p);
    for (let iter = 0; iter < 40; iter++) {
      const Xp = X.map((row) => dot(row, p)); // length n
      const cp = new Array(d).fill(0);
      for (let r = 0; r < n; r++) {
        const xr = X[r];
        const w = Xp[r];
        for (let i = 0; i < d; i++) cp[i] += xr[i] * w;
      }
      if (exclude) {
        const proj = dot(cp, exclude);
        for (let i = 0; i < d; i++) cp[i] -= proj * exclude[i];
      }
      normalize(cp);
      p = cp;
    }
    return p;
  };

  const pc1 = topPC();
  const pc2 = topPC(pc1);

  const xs = X.map((row) => dot(row, pc1));
  const ys = X.map((row) => dot(row, pc2));

  // normalize each axis to 0..1
  const norm = (arr: number[]): number[] => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const range = max - min || 1;
    return arr.map((v) => (v - min) / range);
  };
  const nx = norm(xs);
  const ny = norm(ys);
  return nx.map((x, i) => ({ x, y: ny[i] }));
}
