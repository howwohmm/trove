// candidate ingest: metadata row + CLIP embedding from the thumb url.
// keep ingest: download full image to /library, sharp-derive blur placeholder
// + dominant color, then unsplash download trigger (compliance).
// the growing-corpus pattern: every fetched candidate is persisted, so the
// rankable pool grows even when the api rate limit is exhausted.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { insertImage, setEmbedding, getEmbedding, type Db } from "@/lib/db";
import { embedImage } from "@/lib/embed";
import { safeFetch, triggerUnsplashDownload, type SourcePhoto } from "@/lib/sources";
import { logError } from "@/lib/log";

export function libraryDir(): string {
  return process.env.TROVE_LIBRARY_DIR ?? join(process.cwd(), "library");
}

/** persist candidates + embed the new ones (embed-once-at-ingest; pin-tower offline) */
export async function ingestCandidates(db: Db, photos: SourcePhoto[]): Promise<string[]> {
  const ingested: string[] = [];
  for (const ph of photos) {
    insertImage(db, {
      id: ph.id,
      source: ph.source,
      url: ph.url,
      width: ph.width,
      height: ph.height,
      color: ph.color ?? null,
      author: ph.author ?? null,
      author_url: ph.authorUrl ?? null,
      download_location: ph.downloadLocation ?? null,
    });
    if (!getEmbedding(db, ph.id)) {
      try {
        const vec = await embedImage(ph.thumbUrl);
        setEmbedding(db, ph.id, vec);
        ingested.push(ph.id);
      } catch (err) {
        logError(db, "ingest.embed", err);
      }
    }
  }
  return ingested;
}

/** on keep: download the display-size image to disk + derive placeholder data */
export async function materializeKeep(db: Db, imageId: string): Promise<void> {
  const row = db.prepare("SELECT url, local_path, download_location FROM images WHERE id=?").get(imageId) as
    | { url: string | null; local_path: string | null; download_location: string | null }
    | undefined;
  if (!row?.url || row.local_path) return;

  const res = await safeFetch(row.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`download ${res.status} for ${imageId}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const dir = libraryDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${imageId}.jpg`);
  writeFileSync(file, buf);

  const img = sharp(buf);
  const meta = await img.metadata();
  const { dominant } = await img.stats();
  const color = `#${[dominant.r, dominant.g, dominant.b]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
  const tiny = await sharp(buf).resize(16).blur(2).jpeg({ quality: 40 }).toBuffer();
  const blurData = `data:image/jpeg;base64,${tiny.toString("base64")}`;

  db.prepare("UPDATE images SET local_path=?, color=?, blur_data=?, width=?, height=? WHERE id=?").run(
    file,
    color,
    blurData,
    meta.width ?? 0,
    meta.height ?? 0,
    imageId
  );

  if (row.download_location) {
    try {
      await triggerUnsplashDownload(row.download_location);
    } catch (err) {
      logError(db, "ingest.downloadTrigger", err);
    }
  }
}
