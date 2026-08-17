import { NextRequest, NextResponse } from 'next/server';

// Public, read-only bridge to the card renderer. The relay secret never reaches the browser and
// this route deliberately exposes only options + preview. Posting from the house account remains
// behind the founder-only /api/studio route.
export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const BOX_SECRET = process.env.CLAIM_SHARED_SECRET || '';
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

type RateBucket = { startedAt: number; count: number };

const globalWithCreatorRateLimit = globalThis as typeof globalThis & {
  creatorCardRateLimit?: Map<string, RateBucket>;
};
const rateLimit = globalWithCreatorRateLimit.creatorCardRateLimit ?? new Map<string, RateBucket>();
globalWithCreatorRateLimit.creatorCardRateLimit = rateLimit;

const noStoreHeaders = {
  'cache-control': 'private, no-store, max-age=0',
  pragma: 'no-cache',
};

function clientKey(req: NextRequest) {
  return (
    req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isRateLimited(req: NextRequest) {
  const key = clientKey(req);
  const now = Date.now();
  if (rateLimit.size > 500) {
    for (const [bucketKey, value] of rateLimit) {
      if (now - value.startedAt >= WINDOW_MS) rateLimit.delete(bucketKey);
    }
  }
  const bucket = rateLimit.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    rateLimit.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS;
}

function unavailable() {
  return NextResponse.json(
    { error: 'Card studio is temporarily unavailable.' },
    { status: 503, headers: noStoreHeaders },
  );
}

async function forward(action: 'options' | 'preview', init: RequestInit) {
  if (!RELAY || !BOX_SECRET) return unavailable();
  try {
    const response = await fetch(`${RELAY}/studio/${action}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'x-claim-secret': BOX_SECRET,
      },
      cache: 'no-store',
    });
    const body = await response.text();
    if (!response.ok) {
      let message = 'The live market changed. Refresh and try again.';
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.length < 180) message = parsed.error;
      } catch { /* keep the safe public message */ }
      return NextResponse.json({ error: message }, { status: response.status, headers: noStoreHeaders });
    }
    return new NextResponse(body, {
      status: 200,
      headers: { ...noStoreHeaders, 'content-type': 'application/json' },
    });
  } catch {
    return unavailable();
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (action !== 'options') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: noStoreHeaders });
  }
  if (isRateLimited(req)) {
    return NextResponse.json(
      { error: 'Too many previews. Wait a minute and try again.' },
      { status: 429, headers: noStoreHeaders },
    );
  }
  return forward('options', { method: 'GET' });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (action !== 'preview') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: noStoreHeaders });
  }
  if (isRateLimited(req)) {
    return NextResponse.json(
      { error: 'Too many previews. Wait a minute and try again.' },
      { status: 429, headers: noStoreHeaders },
    );
  }

  const body = await req.json().catch(() => null) as {
    marketId?: unknown; strikeUsd?: unknown; creatorHandle?: unknown;
  } | null;
  const marketId = typeof body?.marketId === 'string' ? body.marketId : '';
  const strikeUsd = Number(body?.strikeUsd);
  // The handle is drawn onto the card, so it is untrusted display text reaching an image
  // renderer. Constrain it to what X actually allows rather than passing it through: 1-15
  // characters, letters, digits and underscore. Anything else is dropped, not rejected, so a
  // bad handle costs the creator their byline and never their card.
  const rawHandle = typeof body?.creatorHandle === 'string' ? body.creatorHandle.replace(/^@/, '') : '';
  const creatorHandle = /^[A-Za-z0-9_]{1,15}$/.test(rawHandle) ? rawHandle : undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
    return NextResponse.json({ error: 'Choose a live market.' }, { status: 400, headers: noStoreHeaders });
  }
  if (!Number.isFinite(strikeUsd) || strikeUsd < 1 || strikeUsd > 10_000_000) {
    return NextResponse.json({ error: 'Enter a valid strike price.' }, { status: 400, headers: noStoreHeaders });
  }

  return forward('preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marketId, strikeUsd: Math.round(strikeUsd), creatorHandle }),
  });
}
