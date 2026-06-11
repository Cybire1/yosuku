// Caching proxy for the DeepBook Predict server. Replaces the old transparent
// next.config rewrite so we can put a short edge cache in front of the slow
// upstream (~1s TTFB). Repeat opens of the same market now hit Vercel's CDN
// (sub-100ms) instead of the upstream every time.
//
// Shared market data (oracles / trades / positions / vault) is cached briefly;
// per-user `managers/*` data is never cached so a fresh trade shows immediately.
import { NextRequest, NextResponse } from 'next/server';

const UPSTREAM = 'https://predict-server.testnet.mystenlabs.com';

/** Edge cache window per path family, or null = never cache (always fresh). */
function cachePolicy(path: string): { sMaxAge: number; swr: number } | null {
  if (path.startsWith('managers/')) return null;            // user-specific → always fresh
  if (path.startsWith('predicts/')) return { sMaxAge: 15, swr: 120 }; // vault stats move slowly
  if (path.startsWith('oracles/')) return { sMaxAge: 5, swr: 30 };    // state / prices / svi
  if (path.startsWith('trades/')) return { sMaxAge: 5, swr: 30 };
  if (path.startsWith('positions/')) return { sMaxAge: 5, swr: 30 };
  return { sMaxAge: 5, swr: 30 };                            // default for other shared reads
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join('/');
  const url = `${UPSTREAM}/${joined}${req.nextUrl.search}`;
  const policy = cachePolicy(joined);

  try {
    const upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      // Also cache the upstream call in Next's data cache so a CDN miss still
      // avoids hammering the predict-server; managers/* always revalidate.
      next: policy ? { revalidate: policy.sMaxAge } : undefined,
      ...(policy ? {} : { cache: 'no-store' as const }),
    });

    const body = await upstream.text();
    const res = new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });

    if (policy && upstream.ok) {
      const cc = `public, s-maxage=${policy.sMaxAge}, stale-while-revalidate=${policy.swr}`;
      res.headers.set('Cache-Control', cc);
      res.headers.set('CDN-Cache-Control', cc);
    } else {
      res.headers.set('Cache-Control', 'no-store');
    }
    return res;
  } catch {
    return NextResponse.json({ error: 'Predict server unreachable.' }, { status: 502 });
  }
}
