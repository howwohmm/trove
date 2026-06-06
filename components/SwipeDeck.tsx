"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "motion/react";
import type { Candidate, SwipeDir } from "@/lib/types";
import { LottiePlayer } from "@/components/LottiePlayer";

const FETCH_AHEAD = 6;
const THRESHOLD = 110;
const VELOCITY = 600;

type Dir = "like" | "skip" | "dream";

function preload(url: string) {
  const img = new Image();
  img.src = url;
  if (img.decode) img.decode().catch(() => {});
}

export function SwipeDeck() {
  const [deck, setDeck] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(0);
  const [seenCount, setSeenCount] = useState(0);
  const [ranked, setRanked] = useState(false);
  const [tasteCount, setTasteCount] = useState(0);
  const [facets, setFacets] = useState<{ id: string; label: string }[]>([]);
  const [facetId, setFacetId] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ key: number; kind: "sparkle" | "success" } | null>(null);
  const fetching = useRef(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  // ambient backdrop reacts to drag too (subtle parallax)
  const likeGlow = useTransform(x, [30, 150], [0, 1]);
  const passGlow = useTransform(x, [-150, -30], [1, 0]);
  const dreamGlow = useTransform(y, [-150, -30], [1, 0]);

  const fetchMore = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetch(`/api/candidates?n=20${facetId ? `&facet=${facetId}` : ""}`);
      const data = (await res.json()) as { candidates: Candidate[]; ranked: boolean; tasteCount: number };
      setRanked(data.ranked);
      setTasteCount(data.tasteCount);
      setDeck((prev) => {
        const have = new Set(prev.map((c) => c.id));
        return [...prev, ...data.candidates.filter((c) => !have.has(c.id))];
      });
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [facetId]);

  useEffect(() => {
    fetch("/api/facets")
      .then((r) => r.json())
      .then((d: { facets: { id: string; label: string }[] }) => setFacets(d.facets))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchMore();
  }, [fetchMore]);

  useEffect(() => {
    deck.slice(0, 3).forEach((c) => preload(c.url));
    if (deck.length <= FETCH_AHEAD) fetchMore();
  }, [deck, fetchMore]);

  const selectFacet = useCallback(
    (id: string | null) => {
      setFacetId(id);
      setDeck([]);
      x.set(0);
      y.set(0);
    },
    [x, y]
  );

  const commit = useCallback(
    (dir: Dir) => {
      const top = deck[0];
      if (!top) return;

      const apiDir: SwipeDir = dir === "skip" ? "skip" : "like";
      fetch("/api/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: top, dir: apiDir }),
      }).catch(() => {});
      if (dir === "dream") fetch("/api/dream", { method: "POST" }).catch(() => {});

      setSeenCount((n) => n + 1);
      if (dir !== "skip") {
        setSaved((n) => n + 1);
        setBurst({ key: Date.now(), kind: dir === "dream" ? "success" : "sparkle" });
        setTimeout(() => setBurst(null), 1000);
      }

      const target = dir === "like" ? { x: 1300, y: 0 } : dir === "skip" ? { x: -1300, y: 0 } : { x: 0, y: -1300 };
      const mv = dir === "dream" ? y : x;
      animate(mv, dir === "dream" ? target.y : target.x, { duration: 0.3, ease: [0.32, 0.72, 0, 1] }).then(() => {
        setDeck((prev) => prev.slice(1));
        x.set(0);
        y.set(0);
      });
    },
    [deck, x, y]
  );

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.y < -THRESHOLD || velocity.y < -VELOCITY) commit("dream");
      else if (offset.x > THRESHOLD || velocity.x > VELOCITY) commit("like");
      else if (offset.x < -THRESHOLD || velocity.x < -VELOCITY) commit("skip");
      else {
        animate(x, 0, { type: "spring", stiffness: 500, damping: 38 });
        animate(y, 0, { type: "spring", stiffness: 500, damping: 38 });
      }
    },
    [commit, x, y]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") commit("like");
      if (e.key === "ArrowLeft") commit("skip");
      if (e.key === "ArrowUp") commit("dream");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const top = deck[0];
  const under = deck[1];

  return (
    <div className="immersive">
      {/* ambient: blurred current image washes the whole surface in its colors */}
      {top && (
        <div
          key={`amb-${top.id}`}
          className="ambient"
          style={{ backgroundImage: `url(${top.url})` }}
        />
      )}

      <div className="imm-top">
        {facets.length > 0 && (
          <div className="chips">
            <button className={`chip ${!facetId ? "chip--on" : ""}`} onClick={() => selectFacet(null)}>
              all
            </button>
            {facets.map((f) => (
              <button
                key={f.id}
                className={`chip ${facetId === f.id ? "chip--on" : ""}`}
                onClick={() => selectFacet(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <p className="taste-state">
          {ranked
            ? `taste · tuned to ${tasteCount} keeps`
            : tasteCount > 0
              ? `taste · warming up · ${tasteCount} keeps`
              : "taste · calibrating — keep a few to begin"}
        </p>
      </div>

      <div className="stage">
        {loading && deck.length === 0 && (
          <div className="hint">
            <LottiePlayer name="typing" className="lottie-load" />
          </div>
        )}
        {!loading && !top && <p className="hint">that&apos;s the pool for now. refresh to keep going.</p>}

        {under && (
          <div className="icard icard--under" key={under.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={under.url} alt="" draggable={false} />
          </div>
        )}

        {top && (
          <motion.div
            key={top.id}
            className="icard icard--top"
            style={{ x, y, rotate }}
            drag
            dragSnapToOrigin={false}
            dragElastic={0.5}
            onDragEnd={onDragEnd}
            whileTap={{ cursor: "grabbing" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={top.url} alt="" draggable={false} />
            <motion.div className="glow glow--like" style={{ opacity: likeGlow }} />
            <motion.div className="glow glow--pass" style={{ opacity: passGlow }} />
            <motion.div className="glow glow--dream" style={{ opacity: dreamGlow }} />
            <motion.span className="dir dir--like" style={{ opacity: likeGlow }}>keep</motion.span>
            <motion.span className="dir dir--pass" style={{ opacity: passGlow }}>pass</motion.span>
            <motion.span className="dir dir--dream" style={{ opacity: dreamGlow }}>dream it ✦</motion.span>
            {top.author && (
              <span className="byline">
                {top.author}
                <span className="src"> · {top.source}</span>
              </span>
            )}
          </motion.div>
        )}

        {burst && (
          <div className="burst" key={burst.key}>
            <LottiePlayer name={burst.kind} loop={false} />
          </div>
        )}
      </div>

      <div className="imm-controls">
        <button className="btn btn--pass" onClick={() => commit("skip")} aria-label="pass">✕</button>
        <button className="btn btn--dream" onClick={() => commit("dream")} aria-label="dream it">✦</button>
        <div className="count">
          <span>{saved} kept</span>
          <span className="dim">{seenCount} seen</span>
        </div>
        <button className="btn btn--keep" onClick={() => commit("like")} aria-label="keep">♥</button>
      </div>
    </div>
  );
}
