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

const W = 4600; // virtual canvas size (roomy → less crowding)
const H = 3100;
const NODE = 132;

// push overlapping nodes apart while keeping the cluster structure — turns the
// crammed PCA scatter into a clean, readable spread (public.work feel)
function declutter(nodes: Node[]): Node[] {
  const pts = nodes.map((n) => ({ x: n.x * W, y: n.y * H }));
  const min = NODE * 1.18;
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d;
          dy /= d;
          pts[i].x -= dx * push;
          pts[i].y -= dy * push;
          pts[j].x += dx * push;
          pts[j].y += dy * push;
        }
      }
    }
  }
  return nodes.map((n, i) => ({
    ...n,
    x: Math.max(0, Math.min(W, pts[i].x)) / W,
    y: Math.max(0, Math.min(H, pts[i].y)) / H,
  }));
}

export function TasteMap() {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(0.42);

  useEffect(() => {
    fetch("/api/taste-map")
      .then((r) => r.json())
      .then((d: { nodes: Node[] }) => setNodes(declutter(d.nodes)))
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
