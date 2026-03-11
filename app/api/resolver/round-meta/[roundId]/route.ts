import { NextRequest, NextResponse } from 'next/server';
import { getResolverBackendUrl } from '@/lib/backendUrl';

interface RouteContext {
  params: Promise<{ roundId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { roundId } = await context.params;

  try {
    const upstream = `${getResolverBackendUrl(request.url)}/api/round-meta/${roundId}`;
    const response = await fetch(upstream, {
      method: 'GET',
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
