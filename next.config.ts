import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // Keep the @yosuku/predict SDK (and its Node-only Buffer usage) in the server
  // runtime only — it powers the /api/yosuku/* devInspect routes, never the client bundle.
  serverExternalPackages: ['@yosuku/predict'],
  async rewrites() {
    return [
      {
        source: '/api/predict/:path*',
        destination: 'https://predict-server.testnet.mystenlabs.com/:path*',
      },
    ];
  },
};

export default nextConfig;
