import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
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
