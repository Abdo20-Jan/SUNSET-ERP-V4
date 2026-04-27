import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "date-fns",
      "@base-ui/react",
      "@tanstack/react-table",
      "cmdk",
    ],
  },
};

export default nextConfig;
