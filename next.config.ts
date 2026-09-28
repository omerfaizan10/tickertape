import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard reads the golden set and the eval reports from disk at
  // request time, through paths the bundler can't trace on its own, so a
  // deployment has to be told to ship them.
  outputFileTracingIncludes: {
    "/*": ["./data/golden/**/*", "./eval/**/*"],
  },
};

export default nextConfig;
