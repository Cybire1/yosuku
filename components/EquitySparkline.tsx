'use client';

// ── EquitySparkline — the striking honest visual ──
//
// Draws the desk's CUMULATIVE net profit/loss as an equity curve, oldest→newest,
// one step per settled trade. It rises on wins and DROPS on losses — the drawdown
// is drawn, never hidden. That honesty is the whole point: the curve shows the
// losing side as plainly as the winning side.
//
// Pure inline SVG, no deps. Vermilion #E04D26 is the only accent; below-zero
// territory is drawn muted (never green, never red-alarm) so a loss reads as a
// fact, not a scare.

import { useId } from 'react';

export type EquityPoint = { t: number; cum: number }; // cum = cumulative net in whole USDC

export default function EquitySparkline({
  points,
  width = 300,
  height = 72,
  className = '',
}: {
  points: EquityPoint[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const pad = 3;

  // Need at least two points to draw a line; a single settle still gets a flat seed at 0.
  const series: EquityPoint[] =
    points.length === 0
      ? []
      : points.length === 1
        ? [{ t: points[0].t - 1, cum: 0 }, points[0]]
        : points;

  if (series.length === 0) {
    return (
      <div
        className={`flex items-center justify-center border border-white/[0.06] bg-white/[0.015] ${className}`}
        style={{ width, height }}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/25">
          curve fills as trades settle
        </span>
      </div>
    );
  }

  const cums = series.map((p) => p.cum);
  let lo = Math.min(0, ...cums);
  let hi = Math.max(0, ...cums);
  if (hi === lo) { hi += 1; lo -= 1; } // avoid a divide-by-zero on a perfectly flat curve
  const span = hi - lo;

  const n = series.length;
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const zeroY = y(0);

  const linePts = series.map((p, i) => `${x(i).toFixed(2)},${y(p.cum).toFixed(2)}`);
  const linePath = `M ${linePts.join(' L ')}`;
  const areaPath = `${linePath} L ${x(n - 1).toFixed(2)},${zeroY.toFixed(2)} L ${x(0).toFixed(2)},${zeroY.toFixed(2)} Z`;

  const last = series[n - 1];
  const dotX = x(n - 1);
  const dotY = y(last.cum);
  const up = last.cum >= 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Cumulative result curve, currently ${last.cum >= 0 ? 'up' : 'down'} ${Math.abs(last.cum).toFixed(2)}`}
    >
      <defs>
        <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E04D26" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#E04D26" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* zero baseline — the honesty datum: everything under it is a net loss */}
      <line
        x1={pad}
        x2={width - pad}
        y1={zeroY}
        y2={zeroY}
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {/* soft fill only above zero, so the up-region carries the accent */}
      <path d={areaPath} fill={`url(#fill-${gid})`} />

      {/* the curve itself — vermilion above/at zero, muted below (a loss is a fact) */}
      <path
        d={linePath}
        fill="none"
        stroke={up ? '#E04D26' : 'rgba(255,255,255,0.55)'}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* current position marker */}
      <circle cx={dotX} cy={dotY} r="2.6" fill={up ? '#E04D26' : '#ffffff'} />
      <circle cx={dotX} cy={dotY} r="5" fill="none" stroke={up ? '#E04D26' : '#ffffff'} strokeOpacity="0.3" strokeWidth="1" />
    </svg>
  );
}
