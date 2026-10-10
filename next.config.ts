import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits in the bottom-left corner, on top of the sidebar's profile row.
  // Compile and runtime errors are still surfaced.
  devIndicators: false,
};

export default nextConfig;
