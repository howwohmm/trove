import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // this project is the workspace root (avoids picking up ~/package-lock.json)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
