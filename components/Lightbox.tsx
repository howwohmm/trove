"use client";

// the print room — full-screen detail view per specs/design-contract.md.
// backdrop fades 200ms, content settles in; esc closes, ←/→ walk the grid,
// "more like this" (CLIP neighbors) means it is never a dead end.

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { settle, quiet } from "@/lib/motion";
import { sizedUrl } from "@/components/Masonry";

export interface LightboxItem {
  id: string;
  url: string;
  width: number;
  height: number;
  author?: string | null;
  authorUrl?: string | null;
  source?: string | null;
  keptAt?: number | null;
  facetLabel?: string | null;
}

interface SimilarItem {
  id: string;
  url: string;
  width: number;
  height: number;
  color?: string | null;
  score: number;
}

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
  onLetGo,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** page handles DELETE /api/keep/:id, grid removal, and closing */
  onLetGo: (id: string) => Promise<void>;
}) {
  // a similar-thumb click can land on an image outside the current grid —
  // it overrides until the next arrow/grid navigation.
  const [override, setOverride] = useState<LightboxItem | null>(null);
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [busy, setBusy] = useState(false);

  const current = override ?? items[index];

  useEffect(() => setOverride(null), [index]);

  // keyboard: esc closes, arrows navigate the grid at 0ms (no animation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") {
        setOverride(null);
        onNavigate(Math.max(0, index - 1));
      } else if (e.key === "ArrowRight") {
        setOverride(null);
        onNavigate(Math.min(items.length - 1, index + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onNavigate]);

  // hold the page still underneath
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // CLIP neighbors from your keeps
  useEffect(() => {
    if (!current) return;
    let alive = true;
    setSimilar([]);
    fetch(`/api/similar/${encodeURIComponent(current.id)}`)
      .then((r) => r.json())
      .then((d: { items: SimilarItem[] }) => {
        if (alive) setSimilar(d.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSimilar = useCallback(
    (s: SimilarItem) => {
      const i = items.findIndex((it) => it.id === s.id);
      if (i >= 0) {
        setOverride(null);
        onNavigate(i);
      } else {
        setOverride({ id: s.id, url: s.url, width: s.width, height: s.height });
      }
    },
    [items, onNavigate]
  );

  const letGo = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await onLetGo(current.id);
    } finally {
      setBusy(false);
    }
  }, [current, busy, onLetGo]);

  if (!current) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="image detail"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: quiet }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "oklch(0.1 0.005 75 / 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.4rem",
      }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={settle}
        style={{ display: "flex", gap: "2rem", alignItems: "flex-end", maxWidth: "100%", flexWrap: "wrap" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sizedUrl(current.url, 1400)}
          alt=""
          fetchPriority="high"
          decoding="async"
          style={{
            display: "block",
            maxWidth: "70vw",
            maxHeight: "85vh",
            objectFit: "contain",
            borderRadius: 0,
            background: "var(--raised)",
          }}
        />

        <div style={{ minWidth: 240, maxWidth: 300, display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {current.keptAt != null && (
              <span className="t-mono">kept {new Date(current.keptAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toLowerCase()}</span>
            )}
            {current.author &&
              (current.authorUrl ? (
                <a className="t-mono" href={current.authorUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                  {current.author.toLowerCase()}
                </a>
              ) : (
                <span className="t-mono">{current.author.toLowerCase()}</span>
              ))}
            <span className="t-mono">
              {current.width} × {current.height}
            </span>
            {current.facetLabel && (
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                {current.facetLabel}
              </span>
            )}
          </div>

          {similar.length > 0 && (
            <div>
              <p className="t-mono" style={{ marginBottom: "0.4rem" }}>
                more like this
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}>
                {similar.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openSimilar(s)}
                    aria-label="open similar image"
                    style={{
                      aspectRatio: "1",
                      overflow: "hidden",
                      borderRadius: 0,
                      background: s.color ?? "var(--raised)",
                      padding: 0,
                      display: "block",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sizedUrl(s.url, 120)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <a className="chip" href={current.url} target="_blank" rel="noreferrer">
              open original
            </a>
            <button className={`chip${busy ? " breathing" : ""}`} onClick={letGo} disabled={busy}>
              {busy ? "letting go…" : "let go"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
