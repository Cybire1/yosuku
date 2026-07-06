import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // Keep the @yosuku/deepbook-predict SDK (and its Node-only Buffer usage) in the server
  // runtime only — it powers the /api/yosuku/* devInspect routes, never the client bundle.
  serverExternalPackages: ['@yosuku/deepbook-predict'],
  // NOTE: /api/predict/* is now served by the caching Route Handler at
  // app/api/predict/[...path]/route.ts (a short edge cache in front of the slow
  // upstream), not a transparent rewrite.
  // HTML documents must always revalidate: iOS Safari cached page shells for DAYS,
  // and a stale shell keeps pointing at old (immutable, content-hashed) JS — users
  // saw builds from days ago after every deploy. Hashed /_next/static assets keep
  // their long immutable cache (this rule deliberately excludes them), so only the
  // tiny HTML doc refetches — no perf cost, always the current build.
  async headers() {
    return [
      {
        source: '/((?!_next/|api/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
