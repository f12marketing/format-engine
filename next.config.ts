import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /**
     * Pin the workspace root. Without this, Turbopack walks up past the repo
     * and finds an unrelated pnpm-lock.yaml in the home directory, then warns
     * on every start about ignoring it.
     */
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
