import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  typedRoutes: true,
  allowedDevOrigins: ["*.trimmycrm.localhost"],
};

export default nextConfig;
