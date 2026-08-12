import { NextResponse } from 'next/server';

// Mobile -> box proxy for price alerts. The mobile app hits ${WEB_BASE}/api/alerts so it
// only ever talks to yosuku.xyz; we forward to the box alert-keeper with a shared secret,
// mirroring app/api/private-bet/open. Inert (503) until ALERT_SERVER_URL is configured, so
// shipping this route changes nothing until the box service + env are live.
export const runtime = 'nodejs';

const SERVER_URL = process.env.ALERT_SERVER_URL?.replace(/\/$/, '') ?? '';
const SECRET = process.env.ALERT_SERVER_SECRET ?? '';

async function forward(method: string, path: string, body?: unknown) {
  if (!SERVER_URL) return NextResponse.json({ error: 'Alerts are not configured yet.' }, { status: 503 });
  try {
    const r = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-yosuku-relay-token': SECRET },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'The alert service is unreachable.' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return forward('POST', '/alerts', body);
}

export async function DELETE(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  return forward('DELETE', `/alerts${qs ? `?${qs}` : ''}`);
}

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  return forward('GET', `/alerts${qs ? `?${qs}` : ''}`);
}
