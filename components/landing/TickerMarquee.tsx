'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

interface CoinPrice {
  price: number;
  change24h: number;
}

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}

export default function TickerMarquee() {
  const { price: btcPrice, change24h: btcChange } = useBtcPrice();
  const [eth, setEth] = useState<CoinPrice>({ price: 0, change24h: 0 });
  const [aleo, setAleo] = useState<CoinPrice>({ price: 0, change24h: 0 });
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // Fetch ETH + ALEO from CoinGecko
  useEffect(() => {
    let cancelled = false;
    async function fetchPrices() {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,aleo&vs_currencies=usd&include_24hr_change=true'
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.ethereum) {
          setEth({ price: data.ethereum.usd, change24h: data.ethereum.usd_24h_change ?? 0 });
        }
        if (data.aleo) {
          setAleo({ price: data.aleo.usd, change24h: data.aleo.usd_24h_change ?? 0 });
        }
      } catch { /* silent */ }
    }
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Measure track width for seamless loop
  useEffect(() => {
    if (trackRef.current) {
      setTrackWidth(trackRef.current.scrollWidth / 2);
    }
  }, [btcPrice, eth.price, aleo.price]);

  const items = [
    { symbol: 'BTC', price: btcPrice, change: btcChange },
    { symbol: 'ETH', price: eth.price, change: eth.change24h },
    { symbol: 'ALEO', price: aleo.price, change: aleo.change24h },
    { symbol: 'DART VOL', price: 12450, change: null as number | null },
  ];

  const renderItems = () =>
    items.map((item, i) => (
      <span key={i} className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-zinc-400 font-medium">{item.symbol}</span>
        <span className="text-white font-mono font-semibold">
          {item.symbol === 'DART VOL' ? item.price.toLocaleString() : `$${fmt(item.price)}`}
        </span>
        {item.change !== null && (
          <span className={`font-mono text-sm ${item.change >= 0 ? 'text-[#34D399]' : 'text-[#F43F5E]'}`}>
            {item.change >= 0 ? '▲' : '▼'}{Math.abs(item.change).toFixed(1)}%
          </span>
        )}
        <span className="text-zinc-600 mx-4">·</span>
      </span>
    ));

  return (
    <div className="w-full overflow-hidden bg-zinc-900/80 backdrop-blur-sm border-t border-zinc-800 py-3">
      <motion.div
        ref={trackRef}
        className="flex items-center text-sm gap-0"
        animate={trackWidth > 0 ? { x: [0, -trackWidth] } : undefined}
        transition={{
          x: {
            duration: 25,
            repeat: Infinity,
            ease: 'linear',
          },
        }}
      >
        {/* Duplicate content for seamless loop */}
        {renderItems()}
        {renderItems()}
        {renderItems()}
        {renderItems()}
      </motion.div>
    </div>
  );
}
