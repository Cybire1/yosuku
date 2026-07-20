import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy for the Line Studio. Holds the box secret (never sent to the browser) and
// gates every call on the founder passphrase (STUDIO_PASSPHRASE). The browser only ever sends
// the passphrase; this route swaps it for the box's x-claim-secret and forwards to the relay's
// claim server (/studio/*). Keeps CLAIM_SHARED_SECRET out of client code.
export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;          // e.g. http://100.54.126.119:8789
const BOX_SECRET = process.env.CLAIM_SHARED_SECRET || '';
const PASS = process.env.STUDIO_PASSPHRASE || '';
const ALLOWED = new Set(['options', 'lines', 'preview', 'post']);

const passOk = (req: NextRequest) => !!PASS && req.headers.get('x-studio-pass') === PASS;

async function forward(action: string, init: RequestInit) {
  if (!RELAY) return NextResponse.json({ error: 'studio not configured (CLAIM_EXECUTOR_URL missing)' }, { status: 503 });
  try {
    const r = await fetch(`${RELAY}/studio/${action}`, { ...init, headers: { ...(init.headers || {}), 'x-claim-secret': BOX_SECRET }, cache: 'no-store' });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({ error: 'box unreachable: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120) }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!passOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (action === 'auth') return NextResponse.json({ ok: true });
  if (!ALLOWED.has(action)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const search = new URL(req.url).search;
  return forward(`${action}${search}`, { method: 'GET' });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!passOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ALLOWED.has(action)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.text();
  return forward(action, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}
