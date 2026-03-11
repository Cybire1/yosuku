import { NextRequest, NextResponse } from 'next/server';
import { getResolverBackendUrl } from '@/lib/backendUrl';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const upstream = `${getResolverBackendUrl(request.url)}/api/bet`;
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': request.headers.get('content-type') || 'application/json',
      },
      body,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resolver backend unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
