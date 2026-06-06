import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // this project is the workspace root (avoids picking up ~/package-lock.json)
  turbopack: {
    root: __dirname,
  },
  // native deps used by the CLIP embedder — don't try to bundle them
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
