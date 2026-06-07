"use client";

import { useEffect, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { optimized } from "@/lib/imgix";

export default function LibraryPage() {
  const [all, setAll] = useState<LibraryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryItem[] | null>(null); // null = showing all
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d: { library: LibraryItem[] }) => setAll(d.library))
      .catch(() => setAll([]));
  }, []);

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const d = (await res.json()) as { results: LibraryItem[] };
      setResults(d.results);
    } finally {
      setSearching(false);
    }
  };

  if (all === null) return <p className="hint">loading library…</p>;

  if (all.length === 0)
    return (
      <p className="hint">
        nothing kept yet. go swipe — the ones you keep land here, and on disk in{" "}
        <code>/library</code>.
      </p>
    );

  const items = results ?? all;

  const copyImage = async (it: LibraryItem) => {
    try {
      const res = await fetch(`/api/img/${it.file}`);
      const blob = await res.blob();
      // normalize to png — broadest clipboard-image support
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d")?.drawImage(bmp, 0, 0);
      const png: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopied(it.id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="lib">
      <div className="lib-search">
        <input
          className="lib-input"
          placeholder="search your taste — try “rain on glass at dusk”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch(query);
            if (e.key === "Escape") {
              setQuery("");
              setResults(null);
            }
          }}
        />
        {results !== null && (
          <button
            className="chip"
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
          >
            clear
          </button>
        )}
      </div>
      <p className="lib-head">
        {searching
          ? "searching…"
          : results !== null
            ? `${items.length} matches for “${query}” · ranked by your taste`
            : `${all.length} kept · files live in /library`}
      </p>
      <div className="masonry">
        {items.map((it) => (
          <figure className="tile" key={it.id} title={it.author ? `${it.author} · ${it.source}` : it.source}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.url ? optimized(it.url, 360) : `/api/img/${it.file}`} alt="" loading="lazy" />
            <figcaption className="tile-actions">
              <button onClick={() => copyImage(it)}>{copied === it.id ? "copied ✓" : "copy"}</button>
              <a href={`/api/img/${it.file}`} download>save</a>
              <a href={`/api/img/${it.file}`} target="_blank" rel="noreferrer">open</a>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
