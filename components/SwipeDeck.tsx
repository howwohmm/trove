"use client";

// the swipe surface. discipline (pinterest pwa learnings):
// - MotionValues drive rotate/opacity — ZERO react re-renders during the gesture
// - transform/opacity only, spring exits carry gesture velocity
// - ≤3 mounted cards, next 3 images decoded ahead => paint-free reveals
// - optimistic: animate immediately, persist async, never block the gesture

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";

export interface DeckCard {
  id: string;
  url: string;
  width: number;
  height: number;
  color: string | null;
  author: string | null;
  bucket: "exploit" | "adjacent" | "explore";
  facetId: string | null;
  facetLabel: string | null;
}

interface Facet {
  id: string;
  label: string;
  importance: number;
}

const EXIT_X = typeof window !== "undefined" ? window.innerWidth * 1.2 : 600;

function TopCard({
  card,
  onSwipe,
}: {
  card: DeckCard;
  onSwipe: (action: "keep" | "skip") => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-12, 12]);
  const keepOpacity = useTransform(x, [40, 140], [0, 1]);
  const skipOpacity = useTransform(x, [-140, -40], [1, 0]);
  const fired = useRef(false);

  const fly = useCallback(
    (action: "keep" | "skip", velocity = 0) => {
      if (fired.current) return;
      fired.current = true;
      onSwipe(action); // optimistic — fire before the animation ends
      animate(x, action === "keep" ? EXIT_X : -EXIT_X, {
        type: "spring",
        stiffness: 220,
        damping: 28,
        velocity,
      });
    },
    [onSwipe, x]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") fly("keep");
      if (e.key === "ArrowLeft") fly("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fly]);

  return (
    <motion.div
      drag="x"
      dragElastic={0.9}
      style={{
        x,
        rotate,
        position: "absolute",
        inset: 0,
        borderRadius: 16,
        overflow: "hidden",
        background: card.color ?? "var(--bg-raised)",
        touchAction: "pan-y",
        userSelect: "none",
        cursor: "grab",
      }}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 100 || Math.abs(info.velocity.x) > 500) {
          fly(info.offset.x + info.velocity.x * 0.2 > 0 ? "keep" : "skip", info.velocity.x);
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.url}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
      />
      <motion.span
        style={{
          opacity: keepOpacity,
          position: "absolute",
          top: 18,
          left: 18,
          color: "var(--keep)",
          fontSize: "1.05rem",
          fontWeight: 400,
          textShadow: "0 1px 8px rgba(0,0,0,0.5)",
        }}
      >
        keep
      </motion.span>
      <motion.span
        style={{
          opacity: skipOpacity,
          position: "absolute",
          top: 18,
          right: 18,
          color: "var(--skip)",
          fontSize: "1.05rem",
          fontWeight: 400,
          textShadow: "0 1px 8px rgba(0,0,0,0.5)",
        }}
      >
        skip
      </motion.span>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "2.2rem 1rem 0.9rem",
          background: "linear-gradient(transparent, rgba(0,0,0,0.55))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: "0.75rem",
          color: "rgba(255,255,255,0.85)",
          pointerEvents: "none",
        }}
      >
        <span>{card.author ?? ""}</span>
        <span style={{ opacity: 0.7 }}>{card.facetLabel ?? card.bucket}</span>
      </div>
    </motion.div>
  );
}

export function SwipeDeck() {
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [facetFilter, setFacetFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const shownAt = useRef<number>(Date.now());
  const fetching = useRef(false);
  const seen = useRef(new Set<string>());

  const fetchMore = useCallback(
    async (filter: string | null, reset = false) => {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const res = await fetch(`/api/deck${filter ? `?facet=${encodeURIComponent(filter)}` : ""}`);
        const data = (await res.json()) as { cards: DeckCard[] };
        const fresh = data.cards.filter((c) => !seen.current.has(c.id));
        fresh.forEach((c) => seen.current.add(c.id));
        setQueue((q) => (reset ? fresh : [...q, ...fresh]));
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchMore(facetFilter, true);
  }, [facetFilter, fetchMore]);

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: Facet[] }) => setFacets(d.facets.slice(0, 8)))
      .catch(() => {});
  }, []);

  // decode-ahead: the next 3 cards are in the gpu before they surface
  useEffect(() => {
    queue.slice(1, 4).forEach((c) => {
      const img = new Image();
      img.src = c.url;
      img.decode().catch(() => {});
    });
    shownAt.current = Date.now();
  }, [queue]);

  const top = queue[0];

  const handleSwipe = useCallback(
    (action: "keep" | "skip") => {
      if (!top) return;
      const dwellMs = Date.now() - shownAt.current;
      fetch("/api/swipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageId: top.id, action, dwellMs, deckSource: top.bucket }),
      }).catch(() => {});
      // delay removal so the exit animation plays under the next card reveal
      setTimeout(() => setQueue((q) => q.filter((c) => c.id !== top.id)), 240);
      if (queue.length < 5) fetchMore(facetFilter);
    },
    [top, queue.length, fetchMore, facetFilter]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", maxWidth: "100%", padding: "0 0.5rem" }}>
        <button className={`chip ${facetFilter === null ? "on" : ""}`} onClick={() => setFacetFilter(null)}>
          everything
        </button>
        {facets.map((f) => (
          <button
            key={f.id}
            className={`chip ${facetFilter === f.id ? "on" : ""}`}
            onClick={() => setFacetFilter(facetFilter === f.id ? null : f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          width: "min(92vw, 420px)",
          height: "min(68dvh, 600px)",
        }}
      >
        {queue.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: "0.9rem",
            }}
          >
            {loading ? "warming the pool…" : "pool is dry — check /status"}
          </div>
        )}
        {queue
          .slice(0, 3)
          .map((card, i) => (
            <div
              key={card.id}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 3 - i,
                transform: i > 0 ? `scale(${1 - i * 0.04}) translateY(${i * 10}px)` : undefined,
                transition: "transform 0.25s ease",
                pointerEvents: i === 0 ? "auto" : "none",
              }}
            >
              {i === 0 ? (
                <TopCard card={card} onSwipe={handleSwipe} />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 16,
                    overflow: "hidden",
                    background: card.color ?? "var(--bg-raised)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}
            </div>
          ))
          .reverse()}
      </div>

      <p className="small faint" style={{ textAlign: "center" }}>
        drag · or ← skip / keep →
      </p>
    </div>
  );
}
