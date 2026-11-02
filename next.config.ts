import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits in the bottom-left corner, on top of the sidebar's profile row.
  // Compile and runtime errors are still surfaced.
  devIndicators: false,
  // The Docker image (Dockerfile, DigitalOcean) sets NEXT_OUTPUT=standalone for a small self-contained server.
  // Unset everywhere else, so Vercel and local builds are exactly as before.
  ...(process.env.NEXT_OUTPUT === "standalone" && { output: "standalone" as const }),
};

export default nextConfig;
