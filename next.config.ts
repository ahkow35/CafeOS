import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,
  // Enable standalone output for Docker/Jenkins optimization
  output: "standalone",
};

export default nextConfig;
