// smart-feed-lite: candidates wait in per-bucket pools, scored at insert;
// the deck generator pops by quota + MMR; shown cards are never re-scored
// mid-session (materialized-feed principle). pooled rows are re-scored only
// when facets change — never per request (v1 H5: full-corpus rescan, gone).

import {
  blobToVec,
  vecToBlob,
  kvGet,
  kvSet,
  poolInsert,
  recordSwipe,
  type Db,
  type SwipeInput,
} from "@/lib/db";
import {
  computeFacets,
  dot,
  sessionVec,
  antiTasteVec,
  type Facet,
  type Item,
} from "@/lib/taste";
import {
  scoreCandidate,
  assembleDeck,
  mixQuotas,
  type Bucket,
  type RankedCandidate,
  type TasteState,
} from "@/lib/score";
import { searchUnsplash, randomUnsplash, picsumPool, hasUnsplash } from "@/lib/sources";
import { ingestCandidates, materializeKeep } from "@/lib/ingest";
import { embedTexts } from "@/lib/embed";
import { VOCAB } from "@/lib/vocab";
import { logError } from "@/lib/log";

const RECLUSTER_EVERY = 5;
const POOL_TARGET: Record<Bucket, number> = { exploit: 50, adjacent: 30, explore: 25 };
const COLD_START_KEEPS = 15;

// ---------- vocab embeddings (embed once, cache in kv + module) ----------

declare global {
  var __troveVocab: Float32Array[] | undefined;
}

export async function vocabVecs(db: Db): Promise<Float32Array[]> {
  if (globalThis.__troveVocab) return globalThis.__troveVocab;
  const cached = kvGet(db, "vocab_vecs_v1");
  if (cached) {
    const raw = Buffer.from(cached, "base64");
    const all = blobToVec(new Uint8Array(raw));
    const dim = all.length / VOCAB.length;
    const out = VOCAB.map((_, i) => all.slice(i * dim, (i + 1) * dim));
    globalThis.__troveVocab = out;
    return out;
  }
  const vecs = await embedTexts(VOCAB);
  const dim = vecs[0].length;
  const flat = new Float32Array(VOCAB.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  kvSet(db, "vocab_vecs_v1", Buffer.from(vecToBlob(flat)).toString("base64"));
  globalThis.__troveVocab = vecs;
  return vecs;
}

export async function topWords(db: Db, centroid: Float32Array, k: number): Promise<string[]> {
  const vv = await vocabVecs(db);
  return VOCAB.map((w, i) => ({ w, s: dot(centroid, vv[i]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.w);
}

// ---------- taste state from db ----------

interface DbFacet extends Facet {
  label: string | null;
  keywords: string[];
}

export function loadFacets(db: Db): DbFacet[] {
  const rows = db.prepare("SELECT * FROM facets").all() as {
    id: string;
    medoid_image_id: string;
    centroid: Uint8Array;
    member_ids: string;
    importance: number;
    label: string | null;
    keywords: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    medoidId: r.medoid_image_id,
    centroid: blobToVec(r.centroid),
    memberIds: JSON.parse(r.member_ids),
    importance: r.importance,
    label: r.label,
    keywords: r.keywords ? JSON.parse(r.keywords) : [],
  }));
}

export function buildTasteState(db: Db): TasteState {
  const facets = loadFacets(db);

  const keepRows = db
    .prepare(
      `SELECT i.embedding FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='keep' AND s.kind='real' AND i.embedding IS NOT NULL
       ORDER BY s.seq DESC LIMIT 10`
    )
    .all() as { embedding: Uint8Array }[];
  const last10 = keepRows.map((r) => blobToVec(r.embedding));

  const skipRows = db
    .prepare(
      `SELECT i.embedding, s.dwell_ms, s.created_at FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='skip' AND s.kind='real' AND i.embedding IS NOT NULL
       ORDER BY s.seq DESC LIMIT 300`
    )
    .all() as { embedding: Uint8Array; dwell_ms: number; created_at: number }[];

  const swipedRows = db
    .prepare(
      `SELECT i.embedding FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE i.embedding IS NOT NULL ORDER BY s.seq DESC LIMIT 500`
    )
    .all() as { embedding: Uint8Array }[];
  const swipedVecs = swipedRows.map((r) => blobToVec(r.embedding));

  return {
    facets,
    session: sessionVec(last10),
    anti: antiTasteVec(
      skipRows.map((r) => ({ vec: blobToVec(r.embedding), dwellMs: r.dwell_ms, at: r.created_at })),
      Date.now()
    ),
    last10Keeps: last10,
    swipesNear: (c) => {
      let n = 0;
      for (const v of swipedVecs) if (dot(c.vec, v) > 0.8) n++;
      return n;
    },
  };
}

export function realKeepCount(db: Db): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE action='keep' AND kind='real'").get() as {
    n: number;
  };
  return r.n;
}

// ---------- facet recompute (every 5 keeps) + pool rescore ----------

export async function recomputeFacets(db: Db): Promise<void> {
  const keeps = db
    .prepare(
      `SELECT DISTINCT i.id, i.embedding FROM swipes s JOIN images i ON i.id = s.image_id
       WHERE s.action='keep' AND s.kind='real' AND i.embedding IS NOT NULL`
    )
    .all() as { id: string; embedding: Uint8Array }[];
  if (keeps.length < 3) return;

  const items: Item[] = keeps.map((k) => ({ id: k.id, vec: blobToVec(k.embedding) }));
  const swipeTimes = new Map<string, number[]>();
  const stRows = db
    .prepare("SELECT image_id, created_at FROM swipes WHERE action='keep' AND kind='real'")
    .all() as { image_id: string; created_at: number }[];
  for (const r of stRows) {
    const arr = swipeTimes.get(r.image_id) ?? [];
    arr.push(r.created_at);
    swipeTimes.set(r.image_id, arr);
  }

  const prev = loadFacets(db);
  let counter = Number(kvGet(db, "facet_counter") ?? "0");
  const facets = computeFacets(items, swipeTimes, prev, () => `f${++counter}`, Date.now());
  kvSet(db, "facet_counter", String(counter));

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM facets").run();
    const ins = db.prepare(
      "INSERT INTO facets (id, medoid_image_id, centroid, member_ids, importance, label, keywords, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    );
    for (const f of facets) {
      ins.run(
        f.id,
        f.medoidId,
        vecToBlob(f.centroid),
        JSON.stringify(f.memberIds),
        f.importance,
        null,
        null,
        Date.now()
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // label facets from vocab (cheap, no llm)
  for (const f of facets) {
    const words = await topWords(db, f.centroid, 5);
    db.prepare("UPDATE facets SET label=?, keywords=? WHERE id=?").run(
      words.slice(0, 2).join(" · "),
      JSON.stringify(words),
      f.id
    );
  }

  rescorePool(db);
}

export function rescorePool(db: Db): void {
  const t = buildTasteState(db);
  const rows = db
    .prepare(
      `SELECT p.image_id, i.embedding FROM pool p JOIN images i ON i.id = p.image_id
       WHERE p.status='pooled' AND i.embedding IS NOT NULL`
    )
    .all() as { image_id: string; embedding: Uint8Array }[];
  const upd = db.prepare("UPDATE pool SET score=? WHERE image_id=?");
  for (const r of rows) {
    upd.run(scoreCandidate({ id: r.image_id, vec: blobToVec(r.embedding) }, t), r.image_id);
  }
}

// ---------- refill ----------

function poolDepth(db: Db): Record<Bucket, number> {
  const rows = db
    .prepare("SELECT bucket, COUNT(*) AS n FROM pool WHERE status='pooled' GROUP BY bucket")
    .all() as { bucket: Bucket; n: number }[];
  const out: Record<Bucket, number> = { exploit: 0, adjacent: 0, explore: 0 };
  for (const r of rows) out[r.bucket] = r.n;
  return out;
}

function sampleFacets(facets: DbFacet[], n: number): DbFacet[] {
  // sample ∝ importance (pinnersage): tail facets get occasional airtime
  const picked: DbFacet[] = [];
  const rest = [...facets];
  while (picked.length < n && rest.length > 0) {
    const total = rest.reduce((s, f) => s + f.importance, 0) || 1;
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < rest.length; i++) {
      r -= rest[i].importance;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(rest.splice(idx, 1)[0]);
  }
  return picked;
}

function poolUnswiped(db: Db, t: TasteState, ids: string[], source: string, bucket: Bucket): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT i.id, i.embedding FROM images i
       WHERE i.id IN (${placeholders}) AND i.embedding IS NOT NULL AND i.source != 'dream'
       AND i.id NOT IN (SELECT image_id FROM swipes)
       AND i.id NOT IN (SELECT image_id FROM pool WHERE status != 'pooled')`
    )
    .all(...ids) as { id: string; embedding: Uint8Array }[];
  for (const r of rows) {
    poolInsert(db, {
      imageId: r.id,
      source,
      bucket,
      score: scoreCandidate({ id: r.id, vec: blobToVec(r.embedding) }, t),
    });
  }
  return rows.length;
}

/** repool the local corpus: already-embedded, never-swiped images (rate-limit-proof) */
function refillFromCorpus(db: Db, t: TasteState, bucket: Bucket, n: number): number {
  const rows = db
    .prepare(
      `SELECT i.id, i.embedding FROM images i
       WHERE i.embedding IS NOT NULL AND i.source != 'dream' AND i.local_path IS NULL
       AND i.id NOT IN (SELECT image_id FROM swipes)
       AND i.id NOT IN (SELECT image_id FROM pool)
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(n * 3) as { id: string; embedding: Uint8Array }[];
  const scored = rows
    .map((r) => ({ id: r.id, score: scoreCandidate({ id: r.id, vec: blobToVec(r.embedding) }, t) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  for (const s of scored) poolInsert(db, { imageId: s.id, source: "corpus", bucket, score: s.score });
  return scored.length;
}

export async function refillPool(db: Db): Promise<void> {
  const depth = poolDepth(db);
  const t = buildTasteState(db);
  const facets = loadFacets(db);
  const online = hasUnsplash();

  // exploit: top keyword of importance-sampled facets
  if (depth.exploit < POOL_TARGET.exploit) {
    if (online && facets.length > 0) {
      for (const f of sampleFacets(facets, 3)) {
        const kw = f.keywords[0] ?? (await topWords(db, f.centroid, 1))[0];
        try {
          const photos = await searchUnsplash(kw);
          const ids = await ingestCandidates(db, photos);
          poolUnswiped(db, t, ids, `facet:${f.id}`, "exploit");
        } catch (err) {
          logError(db, "refill.exploit", err);
        }
      }
    }
    refillFromCorpus(db, t, "exploit", POOL_TARGET.exploit - poolDepth(db).exploit);
  }

  // adjacent: secondary keywords — near-boundary content, most informative to learn from
  if (depth.adjacent < POOL_TARGET.adjacent) {
    if (online && facets.length > 0) {
      for (const f of sampleFacets(facets, 2)) {
        const kws = f.keywords.slice(2, 5);
        const kw = kws[Math.floor(Math.random() * Math.max(1, kws.length))] ?? f.keywords[0];
        if (!kw) continue;
        try {
          const photos = await searchUnsplash(kw, 16);
          const ids = await ingestCandidates(db, photos);
          poolUnswiped(db, t, ids, `facet-adj:${f.id}`, "adjacent");
        } catch (err) {
          logError(db, "refill.adjacent", err);
        }
      }
    }
    refillFromCorpus(db, t, "adjacent", POOL_TARGET.adjacent - poolDepth(db).adjacent);
  }

  // explore: editorial random — the filter-bubble floor
  if (depth.explore < POOL_TARGET.explore) {
    try {
      if (online) {
        const photos = await randomUnsplash(20);
        const ids = await ingestCandidates(db, photos);
        poolUnswiped(db, t, ids, "editorial", "explore");
      } else {
        const photos = await picsumPool();
        const sample = photos.sort(() => Math.random() - 0.5).slice(0, 30);
        const ids = await ingestCandidates(db, sample);
        poolUnswiped(db, t, ids, "picsum", "explore");
      }
    } catch (err) {
      logError(db, "refill.explore", err);
    }
    refillFromCorpus(db, t, "explore", POOL_TARGET.explore - poolDepth(db).explore);
  }
}

// ---------- deck ----------

export interface DeckCard {
  id: string;
  url: string;
  width: number;
  height: number;
  color: string | null;
  author: string | null;
  authorUrl: string | null;
  bucket: Bucket;
  facetId: string | null;
  facetLabel: string | null;
}

export function popDeck(db: Db, n = 12, facetFilter?: string): DeckCard[] {
  const facets = loadFacets(db);
  const served = (
    db.prepare("SELECT deck_source FROM swipes ORDER BY seq DESC LIMIT 100").all() as {
      deck_source: string | null;
    }[]
  )
    .map((r) => r.deck_source)
    .filter((b): b is Bucket => b === "exploit" || b === "adjacent" || b === "explore");

  const cold = realKeepCount(db) < COLD_START_KEEPS;
  const quotas = cold
    ? ({ exploit: 0, adjacent: 0, explore: n } as Record<Bucket, number>)
    : mixQuotas(served, n);

  const cands: RankedCandidate[] = [];
  for (const bucket of ["exploit", "adjacent", "explore"] as Bucket[]) {
    const want = quotas[bucket];
    if (want === 0) continue;
    let sql = `SELECT p.image_id, p.score, p.source, i.embedding FROM pool p
       JOIN images i ON i.id = p.image_id
       WHERE p.status='pooled' AND p.bucket=? AND i.embedding IS NOT NULL`;
    const args: (string | number)[] = [bucket];
    if (facetFilter) {
      sql += " AND p.source IN (?, ?)";
      args.push(`facet:${facetFilter}`, `facet-adj:${facetFilter}`);
    }
    sql += " ORDER BY p.score DESC LIMIT ?";
    args.push(want * 3); // overfetch for MMR room
    const rows = db.prepare(sql).all(...args) as {
      image_id: string;
      score: number;
      source: string;
      embedding: Uint8Array;
    }[];
    for (const r of rows) {
      const vec = blobToVec(r.embedding);
      let facetId: string | null = null;
      let best = 0.55; // only attribute a facet above a sane floor
      for (const f of facets) {
        const s = dot(vec, f.centroid);
        if (s > best) {
          best = s;
          facetId = f.id;
        }
      }
      cands.push({ id: r.image_id, vec, score: r.score, facetId: facetId ?? bucket, bucket } as RankedCandidate & {
        bucket: Bucket;
      });
    }
  }

  const deck = assembleDeck(cands, n);

  const mark = db.prepare("UPDATE pool SET status='shown' WHERE image_id=?");
  const getImg = db.prepare("SELECT url, width, height, color, author, author_url FROM images WHERE id=?");
  const facetLabel = new Map(facets.map((f) => [f.id, f.label]));

  return deck.map((d) => {
    mark.run(d.id);
    const img = getImg.get(d.id) as {
      url: string;
      width: number;
      height: number;
      color: string | null;
      author: string | null;
      author_url: string | null;
    };
    const bucket = (d as RankedCandidate & { bucket?: Bucket }).bucket ?? "exploit";
    return {
      id: d.id,
      url: img.url,
      width: img.width,
      height: img.height,
      color: img.color,
      author: img.author,
      authorUrl: img.author_url,
      bucket,
      facetId: d.facetId && d.facetId.startsWith("f") ? d.facetId : null,
      facetLabel: d.facetId ? facetLabel.get(d.facetId) ?? null : null,
    };
  });
}

// ---------- swipe ----------

export async function handleSwipe(db: Db, s: SwipeInput): Promise<void> {
  recordSwipe(db, s); // one transaction — the invariant v1 broke
  if (s.action === "keep" && s.kind === "real") {
    try {
      await materializeKeep(db, s.imageId);
    } catch (err) {
      logError(db, "swipe.materialize", err);
    }
    if (realKeepCount(db) % RECLUSTER_EVERY === 0) {
      try {
        await recomputeFacets(db);
      } catch (err) {
        logError(db, "swipe.recluster", err);
      }
    }
  }
}
