import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // API base is read at runtime by the browser via NEXT_PUBLIC_API_URL.
};

export default nextConfig;
