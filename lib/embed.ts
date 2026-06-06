// in-process CLIP image embeddings via transformers.js. no python, no api.
// model weights download once to .models on first use (~90MB).

import path from "path";
import { pipeline, env, AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";

// keep model files inside the project (gitignored), self-contained
env.cacheDir = path.join(process.cwd(), ".models");
env.allowLocalModels = false;

// CLIP ViT-B/32 — image AND text encoders share one 512-dim space, so an image
// embedding and a word embedding are directly cosine-comparable.
const MODEL = "Xenova/clip-vit-base-patch32";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textPromise: Promise<{ tokenizer: any; model: any }> | null = null;

function getPipe() {
  if (!pipePromise) {
    pipePromise = pipeline("image-feature-extraction", MODEL);
  }
  return pipePromise;
}

function getText() {
  if (!textPromise) {
    textPromise = (async () => ({
      tokenizer: await AutoTokenizer.from_pretrained(MODEL),
      model: await CLIPTextModelWithProjection.from_pretrained(MODEL),
    }))();
  }
  return textPromise;
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

// embed words/phrases into the SAME space as images → unit-normalized vectors.
// used to turn a taste vector into search keywords (zero-shot CLIP).
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { tokenizer, model } = await getText();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  return (text_embeds.tolist() as number[][]).map(l2normalize);
}
