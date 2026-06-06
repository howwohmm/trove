// taste → keywords. embed a fixed aesthetic vocabulary once (CLIP text space),
// then score each word against the user's taste vector by cosine → the top words
// describe the taste in language, and drive Unsplash search. (Pinterest's
// "interests as a shared vocabulary", done the canonical CLIP zero-shot way.)

import { embedTexts } from "./embed";
import { cosine } from "./taste";
import { getMeta, setMeta } from "./db";

// curated aesthetic lexicon: palettes, light, mood, style, medium, subject
const VOCAB = [
  // palette / tone
  "muted earth tones", "warm neutrals", "cool desaturated palette", "monochrome",
  "high contrast black and white", "pastel", "moody dark", "warm golden tones",
  "cold blue tones", "sepia", "faded film color", "vivid saturated color",
  "earthy greens", "dusty pink", "ochre and rust", "slate grey",
  // light
  "golden hour light", "soft overcast light", "harsh midday sun", "low key lighting",
  "backlit silhouette", "dappled light", "neon glow", "candlelit warmth",
  "blue hour", "diffused window light",
  // mood
  "minimalist", "serene calm", "melancholic", "dreamy ethereal", "brutalist",
  "nostalgic", "cinematic", "intimate", "stark", "lush", "austere", "romantic",
  // medium / texture
  "film grain", "long exposure", "motion blur", "soft focus", "macro detail",
  "analog photography", "matte texture", "glossy reflection", "grainy 35mm",
  "double exposure",
  // subject / scene
  "minimalist architecture", "concrete brutalism", "misty landscape",
  "calm water reflections", "empty interior", "desert modernism", "forest canopy",
  "urban decay", "coastal seascape", "mountain fog", "still life", "portraiture",
  "negative space composition", "geometric symmetry", "aerial top-down",
  "street photography", "interior design", "botanical", "textile and fabric",
  "ceramics and pottery", "editorial fashion", "fine art nude", "vintage car",
  "neon signage", "rain on glass",
];

let vocabEmb: number[][] | null = null;

async function getVocabEmb(): Promise<number[][]> {
  if (vocabEmb) return vocabEmb;
  const cached = getMeta("vocab_emb");
  if (cached) {
    try {
      const p = JSON.parse(cached) as { n: number; emb: number[][] };
      if (p.n === VOCAB.length) {
        vocabEmb = p.emb;
        return vocabEmb;
      }
    } catch {
      // recompute
    }
  }
  vocabEmb = await embedTexts(VOCAB);
  setMeta("vocab_emb", JSON.stringify({ n: VOCAB.length, emb: vocabEmb }));
  return vocabEmb;
}

let warming = false;

// top-k vocabulary words nearest the taste vector. NON-BLOCKING: if the vocab
// embeddings aren't ready (first ever run downloads the CLIP text model, ~slow),
// warm them in the background and return [] so the feed never hangs. once cached
// in the db, this is instant on every future boot.
export async function tasteKeywords(taste: number[] | null, k = 5): Promise<string[]> {
  if (!taste || !taste.length) return [];
  if (!vocabEmb) {
    // try the db cache synchronously first (fast, no model needed)
    const cached = getMeta("vocab_emb");
    if (cached) {
      try {
        const p = JSON.parse(cached) as { n: number; emb: number[][] };
        if (p.n === VOCAB.length) vocabEmb = p.emb;
      } catch {
        /* recompute below */
      }
    }
    if (!vocabEmb) {
      if (!warming) {
        warming = true;
        getVocabEmb()
          .catch(() => {})
          .finally(() => {
            warming = false;
          });
      }
      return []; // not ready yet — fall back to facet queries / random
    }
  }
  return VOCAB.map((w, i) => ({ w, s: cosine(taste, vocabEmb![i]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.w);
}
