'use client';

import { useState, useEffect, useRef } from 'react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { FLOAT_SCALING } from '@/lib/sui/constants';

// The ticker earns its motion by carrying live signal: asset prices,
// the countdown to the next bell, and the last settlement print.
interface MarqueeItem {
  label: string;
  value: string;
  direction?: 'up' | 'down' | '';
}

interface OracleEntry {
  oracle_id: string;
  status: string;
  expiry: number;
  settled_at: number | null;
  settlement_price?: number | null;
  underlying_asset?: string;
}

const ASSET_ORDER = ['ETH', 'SOL', 'SUI'];
const DECIMALS: Record<string, number> = { BTC: 0, ETH: 0, SOL: 2, SUI: 2 };

export default function Marquee() {
  const { price: btcLive, change24h } = useBtcPrice();
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, 'up' | 'down' | ''>>({});
  const prevSpots = useRef<Record<string, number>>({});
  const [nextExpiry, setNextExpiry] = useState<number | null>(null);
  const [lastBell, setLastBell] = useState<{ asset: string; price: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/oracles?prices=1');
        if (!res.ok) return;
        const { oracles, prices } = (await res.json()) as {
          oracles: OracleEntry[];
          prices: Record<string, { spot?: number }>;
        };
        if (cancelled) return;

        const byAsset: Record<string, number> = {};
        for (const o of oracles) {
          if (o.status !== 'active') continue;
          const asset = o.underlying_asset || 'BTC';
          const p = prices[o.oracle_id];
          if (p?.spot && !byAsset[asset]) byAsset[asset] = p.spot / FLOAT_SCALING;
        }
        const newDirs: Record<string, 'up' | 'down' | ''> = {};
        for (const [asset, cur] of Object.entries(byAsset)) {
          const prev = prevSpots.current[asset];
          newDirs[asset] = prev ? (cur > prev ? 'up' : cur < prev ? 'down' : dirs[asset] ?? '') : '';
        }
        prevSpots.current = byAsset;
        setSpots(byAsset);
        setDirs(newDirs);

        const active = oracles
          .filter(o => o.status === 'active' && o.expiry > Date.now())
          .sort((a, b) => a.expiry - b.expiry);
        setNextExpiry(active[0]?.expiry ?? null);

        const settled = oracles
          .filter(o => o.status === 'settled' && o.settlement_price)
          .sort((a, b) => (b.settled_at ?? b.expiry) - (a.settled_at ?? a.expiry));
        if (settled[0]) {
          setLastBell({
            asset: settled[0].underlying_asset || 'BTC',
            price: (settled[0].settlement_price as number) / FLOAT_SCALING,
          });
        }
      } catch { /* keep last values */ }
    }
    load();
    const iv = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1s heartbeat for the bell countdown
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const usd = (n: number, dp: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  const mmss = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const items: MarqueeItem[] = [];
  const btc = btcLive || spots.BTC;
  if (btc) items.push({ label: 'BTC', value: usd(btc, 0), direction: change24h >= 0 ? 'up' : 'down' });
  for (const asset of ASSET_ORDER) {
    if (spots[asset]) items.push({ label: asset, value: usd(spots[asset], DECIMALS[asset] ?? 2), direction: dirs[asset] ?? '' });
  }
  if (nextExpiry) items.push({ label: 'NEXT BELL', value: mmss(nextExpiry - Date.now()), direction: '' });
  if (lastBell) items.push({ label: 'LAST BELL', value: `${lastBell.asset} ${usd(lastBell.price, DECIMALS[lastBell.asset] ?? 2)}`, direction: '' });
  if (items.length === 0) items.push({ label: 'YOSUKU', value: '予測', direction: '' });

  const renderCells = (keyPrefix: string) =>
    items.map((item, i) => (
      <span key={`${keyPrefix}-${i}`} className="marquee-cell">
        <span className="lbl">{item.label}</span>
        <span className="val">{item.value}</span>
        {item.direction && (
          <span className={item.direction}>{item.direction === 'up' ? '↑' : '↓'}</span>
        )}
      </span>
    ));

  return (
    <div className="marquee">
      <div className="marquee-track">
        {renderCells('a')}
        {renderCells('b')}
        {renderCells('c')}
      </div>
    </div>
  );
}
