// in-process CLIP via transformers.js — no python, no api. explicit
// vision/text projection classes (v1 stack-playbook learning) so image and
// word vectors share one 512-dim space: cosine-comparable directly.

import path from "node:path";
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  RawImage,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
} from "@huggingface/transformers";
import { normalize } from "@/lib/taste";

env.cacheDir = path.join(process.cwd(), ".models");
env.allowLocalModels = false;

const MODEL = "Xenova/clip-vit-base-patch32";

/* eslint-disable @typescript-eslint/no-explicit-any */
let visionPromise: Promise<{ processor: any; model: any }> | null = null;
let textPromise: Promise<{ tokenizer: any; model: any }> | null = null;

function getVision() {
  if (!visionPromise) {
    visionPromise = (async () => ({
      processor: await AutoProcessor.from_pretrained(MODEL, {}),
      model: await CLIPVisionModelWithProjection.from_pretrained(MODEL),
    }))();
  }
  return visionPromise;
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

/** embed an image (url or local file path) → unit Float32Array(512) */
export async function embedImage(urlOrPath: string): Promise<Float32Array> {
  const { processor, model } = await getVision();
  const image = await RawImage.read(urlOrPath);
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  return normalize(new Float32Array(image_embeds.data as Float32Array));
}

/** embed words/phrases into the SAME space → unit Float32Array(512)[] */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const { tokenizer, model } = await getText();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const rows = text_embeds.tolist() as number[][];
  return rows.map((r) => normalize(new Float32Array(r)));
}
