"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type PanInfo,
} from "motion/react";
import type { Candidate, SwipeDir } from "@/lib/types";

const FETCH_AHEAD = 6; // refill the deck when it gets this short
const SWIPE_THRESHOLD = 110; // px of drag to commit
const VELOCITY_THRESHOLD = 600; // flick speed to commit

// preload + decode an image so the card swap is paint-ready (no flash)
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
  const fetching = useRef(false);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const likeOpacity = useTransform(x, [30, 130], [0, 1]);
  const nopeOpacity = useTransform(x, [-130, -30], [1, 0]);

  const fetchMore = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetch("/api/candidates?n=20");
      const data = (await res.json()) as {
        candidates: Candidate[];
        ranked: boolean;
        tasteCount: number;
      };
      setRanked(data.ranked);
      setTasteCount(data.tasteCount);
      setDeck((prev) => {
        const have = new Set(prev.map((c) => c.id));
        const merged = [...prev, ...data.candidates.filter((c) => !have.has(c.id))];
        return merged;
      });
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMore();
  }, [fetchMore]);

  // keep the next few images decoded and ahead-of-cursor
  useEffect(() => {
    deck.slice(0, 3).forEach((c) => preload(c.url));
    if (deck.length <= FETCH_AHEAD) fetchMore();
  }, [deck, fetchMore]);

  const commit = useCallback(
    (dir: SwipeDir) => {
      const top = deck[0];
      if (!top) return;

      // fire-and-forget persistence (download happens server-side on like)
      fetch("/api/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: top, dir }),
      }).catch(() => {});

      setSeenCount((n) => n + 1);
      if (dir === "like") setSaved((n) => n + 1);

      const fly = dir === "like" ? 1200 : -1200;
      animate(x, fly, { duration: 0.28, ease: [0.32, 0.72, 0, 1] }).then(() => {
        setDeck((prev) => prev.slice(1));
        x.set(0);
      });
    },
    [deck, x]
  );

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
        commit("like");
      } else if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
        commit("skip");
      } else {
        animate(x, 0, { type: "spring", stiffness: 500, damping: 38 });
      }
    },
    [commit, x]
  );

  // keyboard: ← skip, → like
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") commit("like");
      if (e.key === "ArrowLeft") commit("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const top = deck[0];
  const under = deck[1];

  return (
    <div className="deck-wrap">
      <p className="taste-state">
        {ranked ? (
          <>taste · tuned to {tasteCount} keeps</>
        ) : tasteCount > 0 ? (
          <>taste · warming up ({tasteCount} keeps)</>
        ) : (
          <>taste · calibrating — keep a few to begin</>
        )}
      </p>
      <div className="deck">
        {loading && deck.length === 0 && <p className="hint">gathering images…</p>}

        {!loading && !top && (
          <p className="hint">
            that&apos;s the pool for now. refresh to keep going.
          </p>
        )}

        {/* card underneath (static, gives the stack depth) */}
        {under && (
          <div className="card card--under" key={under.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={under.url} alt="" draggable={false} />
          </div>
        )}

        {/* top, interactive card */}
        {top && (
          <motion.div
            key={top.id}
            className="card card--top"
            style={{ x, rotate }}
            drag="x"
            dragSnapToOrigin={false}
            dragElastic={0.6}
            onDragEnd={onDragEnd}
            whileTap={{ cursor: "grabbing" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={top.url} alt="" draggable={false} />
            <motion.span className="stamp stamp--like" style={{ opacity: likeOpacity }}>
              keep
            </motion.span>
            <motion.span className="stamp stamp--nope" style={{ opacity: nopeOpacity }}>
              pass
            </motion.span>
            {top.author && (
              <span className="byline">
                {top.author}
                <span className="src"> · {top.source}</span>
              </span>
            )}
          </motion.div>
        )}
      </div>

      <div className="controls">
        <button className="btn btn--pass" onClick={() => commit("skip")} aria-label="pass">
          ✕
        </button>
        <div className="count">
          <span>{saved} kept</span>
          <span className="dim">{seenCount} seen</span>
        </div>
        <button className="btn btn--keep" onClick={() => commit("like")} aria-label="keep">
          ♥
        </button>
      </div>
    </div>
  );
}
