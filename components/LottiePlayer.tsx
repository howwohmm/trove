"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";

// loads a lottie json from /public/lottie and plays it. client-only.
export function LottiePlayer({
  name,
  className,
  loop = true,
  autoplay = true,
}: {
  name: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let live = true;
    fetch(`/lottie/${name}.json`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);

  if (!data) return <span className={className} />;
  return <Lottie animationData={data} loop={loop} autoplay={autoplay} className={className} />;
}
