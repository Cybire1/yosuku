import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable WASM support for @provablehq/wasm (Aleo BHP256 hashing)
  turbopack: {},
  serverExternalPackages: ['@provablehq/wasm'],
};

export default nextConfig;
