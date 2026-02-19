import { NextResponse } from 'next/server';

interface Article {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export async function GET() {
  try {
    // CryptoPanic free tier — public auth token, rate-limited
    const res = await fetch(
      'https://cryptopanic.com/api/free/v1/posts/?currencies=BTC&filter=hot&kind=news',
      { next: { revalidate: 60 } }
    );

    if (res.ok) {
      const data = await res.json();
      const articles: Article[] = (data.results || []).slice(0, 6).map((item: any) => ({
        title: item.title,
        source: item.source?.title || 'Unknown',
        url: item.url,
        publishedAt: item.published_at || item.created_at,
        sentiment: item.votes
          ? item.votes.positive > item.votes.negative ? 'positive'
            : item.votes.negative > item.votes.positive ? 'negative'
            : 'neutral'
          : 'neutral',
      }));

      return NextResponse.json({ articles });
    }

    // Fallback: CoinGecko news (no key needed)
    const fallback = await fetch(
      'https://min-api.cryptocompare.com/data/v2/news/?categories=BTC&sortOrder=popular',
      { next: { revalidate: 60 } }
    );

    if (!fallback.ok) throw new Error('All news sources failed');

    const fbData = await fallback.json();
    const articles: Article[] = (fbData.Data || []).slice(0, 6).map((item: any) => ({
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: new Date(item.published_on * 1000).toISOString(),
      sentiment: 'neutral' as const,
    }));

    return NextResponse.json({ articles });
  } catch (error: any) {
    console.error('Crypto news API error:', error);
    return NextResponse.json(
      { articles: [], error: error.message || 'Failed to fetch news' },
      { status: 500 }
    );
  }
}
