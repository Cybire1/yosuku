import { NextResponse } from 'next/server';

interface Article {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

const FALLBACK_ARTICLES: Article[] = [
  { title: 'Bitcoin Holds Above $72K as Institutional Demand Grows', source: 'CoinDesk', url: 'https://coindesk.com', publishedAt: new Date().toISOString(), sentiment: 'positive' },
  { title: 'Aleo Mainnet Sees Record ZK Proof Generation', source: 'The Block', url: 'https://theblock.co', publishedAt: new Date().toISOString(), sentiment: 'positive' },
  { title: 'Prediction Markets Surge in Volume Amid Crypto Rally', source: 'Decrypt', url: 'https://decrypt.co', publishedAt: new Date().toISOString(), sentiment: 'positive' },
  { title: 'Privacy Coins and ZK Protocols Lead Weekly Gains', source: 'CryptoSlate', url: 'https://cryptoslate.com', publishedAt: new Date().toISOString(), sentiment: 'positive' },
  { title: 'BTC Options Open Interest Hits All-Time High', source: 'Cointelegraph', url: 'https://cointelegraph.com', publishedAt: new Date().toISOString(), sentiment: 'neutral' },
  { title: 'DeFi TVL Crosses $200B as Stablecoin Adoption Accelerates', source: 'DeFi Llama', url: 'https://defillama.com', publishedAt: new Date().toISOString(), sentiment: 'positive' },
];

export async function GET() {
  try {
    // CoinGecko status updates (free, no key)
    const res = await fetch(
      'https://api.coingecko.com/api/v3/news',
      { next: { revalidate: 120 } }
    );

    if (res.ok) {
      const data = await res.json();
      const items = (data.data || data || []).slice(0, 6);
      if (items.length > 0) {
        const articles: Article[] = items.map((item: any) => ({
          title: item.title || item.description?.slice(0, 80) || 'Crypto News',
          source: item.author || item.news_site || 'CoinGecko',
          url: item.url || 'https://coingecko.com',
          publishedAt: item.updated_at || item.created_at || new Date().toISOString(),
          sentiment: 'neutral' as const,
        }));
        return NextResponse.json({ articles });
      }
    }

    // Fallback: static curated articles
    return NextResponse.json({ articles: FALLBACK_ARTICLES });
  } catch {
    return NextResponse.json({ articles: FALLBACK_ARTICLES });
  }
}
