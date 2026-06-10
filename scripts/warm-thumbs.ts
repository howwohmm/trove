import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const db = new DatabaseSync(join(process.cwd(), "data", "trove2.db"), { readOnly: true });
const rows = db.prepare("SELECT id, local_path FROM images WHERE local_path IS NOT NULL").all() as {id:string;local_path:string}[];
const dir = join(process.cwd(), "data", "thumbs");
mkdirSync(dir, { recursive: true });
let made = 0, skipped = 0, failed = 0;
const widths = [480, 640, 800];
(async () => {
  for (const r of rows) {
    if (!existsSync(r.local_path)) { skipped++; continue; }
    for (const w of widths) {
      const out = join(dir, `${r.id}-${w}.webp`);
      if (existsSync(out)) { skipped++; continue; }
      try {
        writeFileSync(out, await sharp(r.local_path).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
        made++;
      } catch { failed++; }
    }
  }
  console.log(`thumbs: ${made} made, ${skipped} skipped, ${failed} failed across ${rows.length} images`);
})();
