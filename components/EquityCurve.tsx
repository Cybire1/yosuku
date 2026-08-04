'use client';

import type { StrategyExit } from '@/lib/sui/strategyClient';

/** Equity curve — cumulative realized P&L across an agent's closed copies, oldest to newest.
 *  The number tells you the result; this tells you HOW it got there (steady vs one lucky spike),
 *  which is the thing a follower is actually judging. Liquidations are marked. */
export default function EquityCurve({ exits, height = 44 }: { exits: StrategyExit[]; height?: number }) {
  if (!exits || exits.length < 2) return null;
  const W = 240, H = height, PAD = 3;
  let run = 0;
  const pts = exits.map((e) => (run += e.pnl));
  const series = [0, ...pts];               // start at flat so the first close reads as a move
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = hi - lo || 1;
  const X = (i: number) => (i / (series.length - 1)) * W;
  const Y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const end = series[series.length - 1];
  const up = end >= 0;
  // Fall back through the app's other tokens to a literal, so the curve is never invisible
  // outside .strat-card (where --gain is scoped). Verified: it rendered near-black in a plain
  // parent before this.
  const stroke = up ? 'var(--gain, var(--profit, #34D399))' : 'var(--loss, #FB7185)';
  const zeroY = lo <= 0 && hi >= 0 ? Y(0) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden className="block">
      {zeroY != null && (
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 3" />
      )}
      <path d={`${d} L${W} ${H} L0 ${H} Z`} fill={stroke} fillOpacity="0.10" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {exits.map((e, i) =>
        e.liquidated ? <circle key={i} cx={X(i + 1)} cy={Y(series[i + 1])} r="2.4" fill="var(--loss, #FB7185)" /> : null,
      )}
      <circle cx={X(series.length - 1)} cy={Y(end)} r="2.6" fill={stroke} />
    </svg>
  );
}
