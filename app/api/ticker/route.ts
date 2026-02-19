import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,sui,aleo,dogecoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true',
      { next: { revalidate: 30 } }
    );

    if (!res.ok) throw new Error('CoinGecko failed');

    const data = await res.json();

    const coins = [
      { symbol: 'BTC', id: 'bitcoin' },
      { symbol: 'ETH', id: 'ethereum' },
      { symbol: 'SOL', id: 'solana' },
      { symbol: 'SUI', id: 'sui' },
      { symbol: 'ALEO', id: 'aleo' },
      { symbol: 'DOGE', id: 'dogecoin' },
    ].map(({ symbol, id }) => ({
      symbol,
      price: data[id]?.usd ?? 0,
      change24h: data[id]?.usd_24h_change ?? 0,
      mcap: data[id]?.usd_market_cap ?? 0,
    }));

    // Fear & Greed index
    let fng = { value: 0, label: 'N/A' };
    try {
      const fngRes = await fetch('https://api.alternative.me/fng/?limit=1', { next: { revalidate: 300 } });
      if (fngRes.ok) {
        const fngData = await fngRes.json();
        const d = fngData.data?.[0];
        if (d) fng = { value: Number(d.value), label: d.value_classification };
      }
    } catch { /* optional */ }

    return NextResponse.json({ coins, fng });
  } catch (error: any) {
    console.error('Ticker API error:', error);
    return NextResponse.json({ coins: [], fng: { value: 0, label: 'N/A' } }, { status: 500 });
  }
}
