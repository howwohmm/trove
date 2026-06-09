"use client";

// /library — the contact sheet. gapless masonry, neighbors dim on hover,
// click opens the print room (Lightbox). specs/design-contract.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { Masonry, type MasonryItem } from "@/components/Masonry";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Footer } from "@/components/Footer";

interface LibItem extends MasonryItem {
  author?: string | null;
  source?: string;
  score?: number;
}

interface LibResponse {
  total: number;
  items: LibItem[];
}

type Density = 2 | 3 | 5;
const DENSITIES: Density[] = [2, 3, 5];

export function LibraryPage() {
  const [items, setItems] = useState<LibItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [density, setDensity] = useState<Density>(3);
  const [seed, setSeed] = useState("soft light");
  const [lbIndex, setLbIndex] = useState<number | null>(null);
  const offset = useRef(0);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/library?offset=${offset.current}&limit=60`);
      const data = (await res.json()) as LibResponse;
      setTotal(data.total);
      setItems((prev) => {
        const have = new Set(prev.map((i) => i.id));
        return [...prev, ...data.items.filter((i) => !have.has(i.id))];
      });
      offset.current += 60;
      setLoaded(true);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    loadMore();
  }, [loadMore]);

  // search placeholder seeded from a real facet keyword
  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: { keywords: string[] }[] }) => {
        setSeed(d.facets[0]?.keywords[2] ?? "soft light");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearching(false);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { items: LibItem[] };
      setItems(data.items);
      setSearching(true);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const resetSearch = useCallback(() => {
    setQuery("");
    setItems([]);
    offset.current = 0;
    busy.current = false;
    setLbIndex(null);
    loadMore();
  }, [loadMore]);

  // density: `-` fewer/bigger · `+` denser (2 / 3 / 5 col)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "-") {
        setDensity((d) => DENSITIES[Math.max(0, DENSITIES.indexOf(d) - 1)]);
      } else if (e.key === "+" || e.key === "=") {
        setDensity((d) => DENSITIES[Math.min(DENSITIES.length - 1, DENSITIES.indexOf(d) + 1)]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // mono strip per cell: match score when searching, source otherwise
  const gridItems = useMemo<LibItem[]>(
    () =>
      items.map((i) => ({
        ...i,
        meta: searching && i.score != null ? `match ${i.score}` : i.source ?? undefined,
      })),
    [items, searching]
  );

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      items.map((i) => ({
        id: i.id,
        url: i.url,
        width: i.width,
        height: i.height,
        author: i.author ?? null,
        source: i.source ?? null,
      })),
    [items]
  );

  const openItem = useCallback(
    (item: MasonryItem) => {
      const i = items.findIndex((it) => it.id === item.id);
      if (i >= 0) setLbIndex(i);
    },
    [items]
  );

  const letGo = useCallback(async (id: string) => {
    const res = await fetch(`/api/keep/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setLbIndex(null);
  }, []);

  const empty = loaded && !searching && items.length === 0;

  return (
    <main className="page">
      <div className="page-body">
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
          <h1 className="t-title">library</h1>
          <span className="t-mono">{searching ? `ranked by "${query.trim()}"` : `${total} kept`}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`try "${seed}"`}
            aria-label="search your keeps"
            style={{
              flex: 1,
              minWidth: 220,
              maxWidth: 420,
              background: "var(--raised)",
              border: "1px solid var(--line)",
              borderRadius: 99,
              padding: "0.45rem 1rem",
              fontSize: "0.85rem",
              outline: "none",
            }}
          />
          {searching && (
            <button className="chip" onClick={resetSearch}>
              clear
            </button>
          )}
          <span className="t-mono" title="density: - / +">
            {density} col
          </span>
        </div>

        {empty ? (
          <p className="t-copy muted" style={{ marginTop: "2rem" }}>
            nothing here yet. that&apos;s fine.{" "}
            <Link href="/" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
              swipe 20 to wake the engine.
            </Link>
          </p>
        ) : (
          <Masonry
            items={gridItems}
            onNearEnd={searching ? undefined : loadMore}
            density={density}
            dimSiblings
            onItemClick={openItem}
          />
        )}
      </div>

      <AnimatePresence>
        {lbIndex !== null && items[lbIndex] && (
          <Lightbox
            items={lightboxItems}
            index={lbIndex}
            onClose={() => setLbIndex(null)}
            onNavigate={setLbIndex}
            onLetGo={letGo}
          />
        )}
      </AnimatePresence>

      <Footer />
    </main>
  );
}

export default LibraryPage;
