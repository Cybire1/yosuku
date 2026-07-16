'use client';

import { useState, useEffect, useRef } from 'react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useBell624, fmtBell624 } from '@/lib/sui/bell624';
import { FLOAT_SCALING } from '@/lib/sui/constants';

// The ticker earns its motion by carrying live signal: asset prices,
// the countdown to the next bell, and the last settlement print.
// NEXT/LAST BELL read the LIVE 6-24 venue (bells ring every minute) — the
// legacy oracles kept below only feed the spot-price fallback.
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

const ASSET_ORDER: string[] = []; // only BTC oracles live on testnet
const DECIMALS: Record<string, number> = { BTC: 0, ETH: 0, SOL: 2, SUI: 2 };

export default function Marquee() {
  const { price: btcLive, change24h } = useBtcPrice();
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, 'up' | 'down' | ''>>({});
  const prevSpots = useRef<Record<string, number>>({});
  const { nextBellMs, lastPrint } = useBell624();
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

  const items: MarqueeItem[] = [];
  const btc = btcLive || spots.BTC;
  if (btc) items.push({ label: 'BTC', value: usd(btc, 0), direction: change24h >= 0 ? 'up' : 'down' });
  for (const asset of ASSET_ORDER) {
    if (spots[asset]) items.push({ label: asset, value: usd(spots[asset], DECIMALS[asset] ?? 2), direction: dirs[asset] ?? '' });
  }
  if (nextBellMs) items.push({ label: 'NEXT CLOSE', value: fmtBell624(nextBellMs - Date.now()), direction: '' });
  if (lastPrint) items.push({ label: 'LAST CLOSE', value: `BTC ${usd(lastPrint.priceUsd, 2)}`, direction: '' });
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
