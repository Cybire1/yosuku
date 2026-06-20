'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TradeData } from '@/lib/sui/predictApi';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

/**
 * Polymarket-style live trade flow. As real trades land (mint = buy, redeem = sell),
 * a small "+$X" badge pops near the right edge of the chart (where "now" is) and floats
 * up while fading — buys in green, sells in rose. History is primed silently on first
 * load so only NEW trades animate; bursts are staggered and capped so it never clutters.
 *
 * Pure overlay: absolutely positioned, pointer-events-none, so it never blocks the chart.
 */
interface Flyer { id: string; dollars: number; buy: boolean; top: number; right: number }

const tradeKey = (t: TradeData) =>
  `${t.checkpoint_timestamp_ms}-${t.manager_id}-${t.type}-${t.quantity}`;

export default function TradeFlow({ trades }: { trades: TradeData[] }) {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const n = useRef(0);

  useEffect(() => {
    if (!trades || trades.length === 0) return;

    // First poll: remember existing trades without animating the backlog.
    if (!primed.current) {
      trades.forEach((t) => seen.current.add(tradeKey(t)));
      primed.current = true;
      return;
    }

    const fresh = trades.filter((t) => !seen.current.has(tradeKey(t)));
    if (fresh.length === 0) return;
    fresh.forEach((t) => seen.current.add(tradeKey(t)));

    // Stagger a batch so backfilled trades flow in one-by-one; cap so it never spams.
    const timers: ReturnType<typeof setTimeout>[] = [];
    fresh.slice(0, 8).forEach((t, i) => {
      const usd = t.type === 'mint'
        ? (t.cost ?? t.quantity / DUSDC_MULTIPLIER)
        : (t.payout ?? t.quantity / DUSDC_MULTIPLIER);
      const dollars = Math.max(1, Math.round(usd));
      const id = `${tradeKey(t)}-${n.current++}`;
      const flyer: Flyer = {
        id,
        dollars,
        buy: t.type === 'mint',
        top: 34 + Math.random() * 40, // % — lower-middle band, near where the line ends
        right: 56 + Math.random() * 26, // px — clear the price axis, slight jitter
      };
      timers.push(setTimeout(() => {
        setFlyers((f) => [...f, flyer]);
        timers.push(setTimeout(() => setFlyers((f) => f.filter((x) => x.id !== id)), 2100));
      }, i * 240));
    });

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
      <AnimatePresence>
        {flyers.map((f) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 0], y: -40, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, ease: 'easeOut', times: [0, 0.12, 0.62, 1] }}
            className={`absolute font-mono text-[12px] font-bold tabular-nums ${f.buy ? 'text-emerald-400' : 'text-rose-400'}`}
            style={{ top: `${f.top}%`, right: f.right, textShadow: '0 1px 6px rgba(0,0,0,0.75)' }}
          >
            {f.buy ? '+' : '−'}${f.dollars}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
