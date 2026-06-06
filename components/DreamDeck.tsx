"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "motion/react";
import type { Dream } from "@/lib/dreams";
import type { SwipeDir } from "@/lib/types";

const THRESHOLD = 110;
const VELOCITY = 600;

export function DreamDeck({
  pending,
  onSwiped,
}: {
  pending: Dream[];
  onSwiped: () => void;
}) {
  const [deck, setDeck] = useState<Dream[]>(pending);
  const [evolving, setEvolving] = useState(false);

  // sync when parent refetches
  useEffect(() => setDeck(pending), [pending]);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const likeOpacity = useTransform(x, [30, 130], [0, 1]);
  const nopeOpacity = useTransform(x, [-130, -30], [1, 0]);

  const commit = useCallback(
    (dir: SwipeDir) => {
      const top = deck[0];
      if (!top) return;
      fetch("/api/dreams/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dreamId: top.id, dir }),
      })
        .then(() => onSwiped())
        .catch(() => {});
      if (dir === "like") {
        setEvolving(true);
        setTimeout(() => setEvolving(false), 2600);
      }
      const fly = dir === "like" ? 1200 : -1200;
      animate(x, fly, { duration: 0.28, ease: [0.32, 0.72, 0, 1] }).then(() => {
        setDeck((prev) => prev.slice(1));
        x.set(0);
      });
    },
    [deck, x, onSwiped]
  );

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.x > THRESHOLD || velocity.x > VELOCITY) commit("like");
      else if (offset.x < -THRESHOLD || velocity.x < -VELOCITY) commit("skip");
      else animate(x, 0, { type: "spring", stiffness: 500, damping: 38 });
    },
    [commit, x]
  );

  const top = deck[0];
  const under = deck[1];

  if (!top) return null;

  return (
    <div className="deck-wrap">
      <p className="taste-state">
        {evolving ? "breeding the next one…" : "judge your dreams — keep breeds, pass kills"}
      </p>
      <div className="deck">
        {under && (
          <div className="card card--under" key={under.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/gen/${under.file}`} alt="" draggable={false} />
          </div>
        )}
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
          <img src={`/api/gen/${top.file}`} alt={top.prompt} draggable={false} />
          <motion.span className="stamp stamp--like" style={{ opacity: likeOpacity }}>
            breed
          </motion.span>
          <motion.span className="stamp stamp--nope" style={{ opacity: nopeOpacity }}>
            kill
          </motion.span>
          <span className="byline">
            dream{top.generation > 0 ? ` · gen ${top.generation}` : ""}
            <span className="src"> · {deck.length} to judge</span>
          </span>
        </motion.div>
      </div>
      <div className="controls">
        <button className="btn btn--pass" onClick={() => commit("skip")} aria-label="kill">
          ✕
        </button>
        <button className="btn btn--keep" onClick={() => commit("like")} aria-label="breed">
          ♥
        </button>
      </div>
    </div>
  );
}
