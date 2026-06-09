// one-time migration: v1 trove.db (json-in-sqlite) -> v2 schema.
// embeddings copy over as raw blobs (same CLIP model, same 512 dims).
// run: npm run import-v1

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { openDb, insertImage, vecToBlob, blobToVec } from "../lib/db";

const V1_PATH = join(process.cwd(), "data", "trove.db");
const LIBRARY = join(process.cwd(), "library");
const GENERATED = join(process.cwd(), "generated");

interface V1CorpusJson {
  id: string;
  url?: string;
  downloadUrl?: string;
  file?: string;
  width?: number;
  height?: number;
  author?: string;
  link?: string;
  source?: string;
}

async function main() {
  if (!existsSync(V1_PATH)) {
    console.error(`no v1 db at ${V1_PATH}`);
    process.exit(1);
  }
  const v1 = new DatabaseSync(V1_PATH, { readOnly: true });
  const v2 = openDb();

  // ---- images from corpus + library ----
  const corpus = v1.prepare("SELECT id, json, ts FROM corpus").all() as { id: string; json: string; ts: number }[];
  const library = v1.prepare("SELECT id, json, ts FROM library").all() as { id: string; json: string; ts: number }[];
  const byId = new Map<string, { j: V1CorpusJson; ts: number; file?: string }>();
  for (const r of corpus) byId.set(r.id, { j: JSON.parse(r.json), ts: r.ts });
  for (const r of library) {
    const j = JSON.parse(r.json) as V1CorpusJson & { file?: string };
    byId.set(r.id, { j, ts: r.ts, file: j.file });
  }

  let images = 0;
  for (const [id, { j, file }] of byId) {
    insertImage(v2, {
      id,
      source: j.source ?? (id.startsWith("picsum") ? "picsum" : "unsplash"),
      url: j.url ?? null,
      width: j.width ?? 800,
      height: j.height ?? 1100,
      author: j.author ?? null,
      author_url: j.link ?? null,
    });
    if (file) {
      const path = join(LIBRARY, file);
      if (existsSync(path)) {
        v2.prepare("UPDATE images SET local_path=? WHERE id=? AND local_path IS NULL").run(path, id);
      }
    }
    images++;
  }
  console.log(`images: ${images} (${library.length} with local files)`);

  // ---- embeddings: raw blob copy (same model, same space) ----
  const embs = v1.prepare("SELECT id, vec FROM embeddings").all() as { id: string; vec: Uint8Array }[];
  let copied = 0;
  const upd = v2.prepare("UPDATE images SET embedding=? WHERE id=?");
  for (const e of embs) {
    if (e.vec.byteLength !== 2048) continue;
    const changes = upd.run(Buffer.from(e.vec), e.id);
    if (Number(changes.changes) > 0) copied++;
  }
  console.log(`embeddings: ${copied}/${embs.length} copied onto image rows`);

  // ---- dreams: image rows + dream rows (kind separation from day one) ----
  const dreams = v1.prepare("SELECT id, json, ts FROM dreams").all() as { id: string; json: string; ts: number }[];
  const genFiles = existsSync(GENERATED) ? readdirSync(GENERATED) : [];
  let dreamCount = 0;
  for (const d of dreams) {
    const j = JSON.parse(d.json) as { id: string; prompt?: string; facetId?: string; parentId?: string };
    const file = genFiles.find((f) => f.startsWith(`${d.id}.`));
    const local = file ? join(GENERATED, file) : null;
    let w = 1024,
      h = 1024;
    if (local) {
      try {
        const meta = await sharp(local).metadata();
        w = meta.width ?? w;
        h = meta.height ?? h;
      } catch {
        /* keep defaults */
      }
    }
    insertImage(v2, { id: d.id, source: "dream", local_path: local, width: w, height: h });
    v2.prepare(
      "INSERT OR IGNORE INTO dreams (id, facet_id, prompt, parent_id, image_id, status, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(d.id, j.facetId ?? null, j.prompt ?? null, j.parentId ?? null, d.id, "done", d.ts);
    dreamCount++;
  }
  console.log(`dreams: ${dreamCount}`);

  // ---- swipes: like->keep, skip->skip; dwell unknown => 2000ms (weak negative) ----
  const swipes = v1.prepare("SELECT id, dir, ts FROM swipes ORDER BY ts ASC").all() as {
    id: string;
    dir: string;
    ts: number;
  }[];
  let s = 0;
  const exists = v2.prepare("SELECT 1 FROM images WHERE id=?");
  const insSwipe = v2.prepare(
    "INSERT INTO swipes (image_id, action, kind, dwell_ms, deck_source, created_at) VALUES (?,?,?,?,NULL,?)"
  );
  v2.exec("BEGIN IMMEDIATE");
  try {
    for (const sw of swipes) {
      if (!exists.get(sw.id)) continue;
      const kind = sw.id.startsWith("dream") ? "dream" : "real";
      insSwipe.run(sw.id, sw.dir === "like" ? "keep" : "skip", kind, 2000, sw.ts);
      s++;
    }
    v2.exec("COMMIT");
  } catch (err) {
    v2.exec("ROLLBACK");
    throw err;
  }
  console.log(`swipes: ${s}/${swipes.length}`);

  // ---- derive placeholder data for kept local files (sharp) ----
  const locals = v2
    .prepare("SELECT id, local_path FROM images WHERE local_path IS NOT NULL AND blur_data IS NULL AND source != 'dream'")
    .all() as { id: string; local_path: string }[];
  let derived = 0;
  for (const row of locals) {
    try {
      const img = sharp(row.local_path);
      const meta = await img.metadata();
      const { dominant } = await img.stats();
      const color = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      const tiny = await sharp(row.local_path).resize(16).blur(2).jpeg({ quality: 40 }).toBuffer();
      v2.prepare("UPDATE images SET color=?, blur_data=?, width=?, height=? WHERE id=?").run(
        color,
        `data:image/jpeg;base64,${tiny.toString("base64")}`,
        meta.width ?? 800,
        meta.height ?? 1100,
        row.id
      );
      derived++;
    } catch (err) {
      console.error(`sharp failed for ${row.id}:`, err);
    }
  }
  console.log(`placeholders derived: ${derived}/${locals.length}`);

  // sanity: a copied embedding must read back as 512 floats
  const check = v2.prepare("SELECT embedding FROM images WHERE embedding IS NOT NULL LIMIT 1").get() as {
    embedding: Uint8Array;
  };
  const vec = blobToVec(check.embedding);
  if (vec.length !== 512) throw new Error(`embedding dim ${vec.length} != 512`);
  void vecToBlob;

  console.log("import done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
