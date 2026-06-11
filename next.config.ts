import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // Keep the @yosuku/deepbook-predict SDK (and its Node-only Buffer usage) in the server
  // runtime only — it powers the /api/yosuku/* devInspect routes, never the client bundle.
  serverExternalPackages: ['@yosuku/deepbook-predict'],
  // NOTE: /api/predict/* is now served by the caching Route Handler at
  // app/api/predict/[...path]/route.ts (a short edge cache in front of the slow
  // upstream), not a transparent rewrite.
};

export default nextConfig;
