import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@huggingface/transformers", "sharp"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;
