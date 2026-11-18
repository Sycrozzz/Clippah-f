import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
