"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "motion/react";
import { optimized } from "@/lib/imgix";

interface Node {
  id: string;
  url: string;
  file: string;
  x: number;
  y: number;
  facet: string | null;
}

const W = 3400; // virtual canvas size
const H = 2300;

export function TasteMap() {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(0.5);

  useEffect(() => {
    fetch("/api/taste-map")
      .then((r) => r.json())
      .then((d: { nodes: Node[] }) => setNodes(d.nodes))
      .catch(() => setNodes([]));
  }, []);

  // wheel = zoom (non-passive so we can preventDefault the page scroll)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = scale.get() * (1 - e.deltaY * 0.0012);
      scale.set(Math.max(0.18, Math.min(4, next)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale]);

  if (!nodes) return <p className="hint">mapping your taste…</p>;
  if (nodes.length === 0)
    return <p className="hint">keep some images first — your taste map grows from them.</p>;

  return (
    <div className="map-wrap" ref={wrapRef}>
      <p className="map-hint">drag to roam · scroll to zoom · {nodes.length} kept</p>
      <motion.div
        className="map-canvas"
        style={{ x, y, scale, width: W, height: H }}
        drag
        dragMomentum
        dragElastic={0}
      >
        {nodes.map((n) => (
          <a
            key={n.id}
            className="map-node"
            style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
            href={`/api/img/${n.file}`}
            target="_blank"
            rel="noreferrer"
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={optimized(n.url, 240)} alt="" draggable={false} loading="lazy" />
            {hover === n.id && n.facet && <span className="map-label">{n.facet}</span>}
          </a>
        ))}
      </motion.div>
    </div>
  );
}
