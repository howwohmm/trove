"use client";

import { useEffect, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { optimized } from "@/lib/imgix";

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d: { library: LibraryItem[] }) => setItems(d.library))
      .catch(() => setItems([]));
  }, []);

  if (items === null) return <p className="hint">loading library…</p>;

  if (items.length === 0)
    return (
      <p className="hint">
        nothing kept yet. go swipe — the ones you keep land here, and on disk in{" "}
        <code>/library</code>.
      </p>
    );

  return (
    <div className="lib">
      <p className="lib-head">
        {items.length} kept · files live in <code>/library</code>
      </p>
      <div className="masonry">
        {items.map((it) => (
          <a
            key={it.id}
            className="tile"
            href={`/api/img/${it.file}`}
            target="_blank"
            rel="noreferrer"
            title={it.author ? `${it.author} · ${it.source}` : it.source}
          >
            {/* imgix-optimized, column-sized image; href opens the full-res local file */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.url ? optimized(it.url, 360) : `/api/img/${it.file}`} alt="" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
