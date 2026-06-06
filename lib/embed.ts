// in-process CLIP image embeddings via transformers.js. no python, no api.
// model weights download once to .models on first use (~90MB).

import path from "path";
import { pipeline, env } from "@huggingface/transformers";

// keep model files inside the project (gitignored), self-contained
env.cacheDir = path.join(process.cwd(), ".models");
env.allowLocalModels = false;

// CLIP ViT-B/32 image encoder → 512-dim embedding
const MODEL = "Xenova/clip-vit-base-patch32";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;

function getPipe() {
  if (!pipePromise) {
    pipePromise = pipeline("image-feature-extraction", MODEL);
  }
  return pipePromise;
}

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

// embed an image by url → unit-normalized vector (cosine = dot product)
export async function embedUrl(url: string): Promise<number[]> {
  const pipe = await getPipe();
  const out = await pipe(url);
  return l2normalize(Array.from(out.data as Float32Array));
}
