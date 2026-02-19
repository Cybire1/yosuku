'use client';

import { useState, useEffect } from 'react';

interface Coin {
  symbol: string;
  price: number;
  change24h: number;
}

interface TickerData {
  coins: Coin[];
  fng: { value: number; label: string };
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fngColor(v: number): string {
  if (v >= 75) return 'text-new-mint';
  if (v >= 55) return 'text-green-400';
  if (v >= 45) return 'text-gray-400';
  if (v >= 25) return 'text-orange-400';
  return 'text-off-red';
}

export default function TickerTape() {
  const [data, setData] = useState<TickerData | null>(null);

  const fetchTicker = async () => {
    try {
      const res = await fetch('/api/ticker');
      const json = await res.json();
      if (json.coins?.length) setData(json);
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchTicker();
    const id = setInterval(fetchTicker, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return (
      <div className="w-full overflow-hidden border-b border-white/[0.04] bg-black/30">
        <div className="h-9 flex items-center gap-8 px-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2.5 w-8 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-2.5 w-14 bg-white/[0.04] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const items = data.coins.map((c) => (
    <span key={c.symbol} className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-[11px] font-bold text-gray-400">{c.symbol}</span>
      <span className="text-[11px] font-mono font-bold text-white">${fmtPrice(c.price)}</span>
      <span className={`text-[10px] font-mono font-bold ${c.change24h >= 0 ? 'text-new-mint' : 'text-off-red'}`}>
        {c.change24h >= 0 ? '+' : ''}{c.change24h.toFixed(1)}%
      </span>
    </span>
  ));

  const fngItem = (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-[11px] font-bold text-gray-400">Fear/Greed</span>
      <span className={`text-[11px] font-mono font-bold ${fngColor(data.fng.value)}`}>
        {data.fng.value}
      </span>
      <span className="text-[10px] text-gray-500">{data.fng.label}</span>
    </span>
  );

  // Separator dot between items
  const dot = <span className="w-1 h-1 rounded-full bg-gray-700 flex-shrink-0" />;

  // Build one full set of items
  const fullSet = [...items.flatMap((item, i) => i > 0 ? [dot, item] : [item]), dot, fngItem];

  return (
    <div className="w-full overflow-hidden border-b border-white/[0.04] bg-black/30 backdrop-blur-sm">
      <div className="ticker-scroll flex items-center h-9 gap-8">
        {/* Two copies for seamless loop */}
        <div className="ticker-track flex items-center gap-6 pr-12">
          {fullSet.map((el, i) => <span key={`a${i}`}>{el}</span>)}
        </div>
        <div className="ticker-track flex items-center gap-6 pr-12" aria-hidden>
          {fullSet.map((el, i) => <span key={`b${i}`}>{el}</span>)}
        </div>
      </div>

      <style jsx>{`
        .ticker-scroll {
          animation: scroll-left 30s linear infinite;
        }
        .ticker-scroll:hover {
          animation-play-state: paused;
        }
        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
