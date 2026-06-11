'use client';

import { useMemo, useRef, useState } from 'react';
import type { SviParams } from '@/lib/sui/predictApi';
import { computeSviPrice } from '@/lib/sui/sviPricing';
import { FLOAT_SCALING } from '@/lib/sui/constants';

/**
 * The strike grid rendered as what it actually is: a tradable probability
 * curve. Every point is a market — click anywhere to select that strike.
 * X: strikes across the oracle grid. Y: SVI fair price of UP, in cents.
 * Vermilion dashed line marks live spot; white dot marks the selected strike.
 */
interface StrikeCurveProps {
  strikes: number[];           // FLOAT_SCALING-encoded
  sviParams: SviParams | null;
  forward: number | null;      // FLOAT_SCALING-encoded
  spot: number | null;         // FLOAT_SCALING-encoded
  selected: number;            // FLOAT_SCALING-encoded
  onSelect: (strike: number) => void;
}

const W = 760, H = 210;
const PAD_L = 46, PAD_R = 18, PAD_T = 26, PAD_B = 34;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;

export default function StrikeCurve({ strikes, sviParams, forward, spot, selected, onSelect }: StrikeCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const points = useMemo(() => {
    if (!sviParams || !forward || strikes.length < 2) return null;
    return strikes.map((s, i) => ({
      strike: s,
      x: PAD_L + (i / (strikes.length - 1)) * INNER_W,
      prob: Math.max(0.01, Math.min(0.99, computeSviPrice(sviParams, s, forward))),
    }));
  }, [strikes, sviParams, forward]);

  if (!points) {
    return (
      <div className="border border-white/[0.08] rounded bg-bg p-4">
        <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-3">Strike Curve</h3>
        <p className="text-[11px] text-gray-600">Curve appears with the next volatility-surface update.</p>
      </div>
    );
  }

  const y = (p: number) => PAD_T + (1 - p) * INNER_H;
  const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${y(pt.prob).toFixed(1)}`).join(' ');
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${y(0)} L${points[0].x.toFixed(1)},${y(0)} Z`;

  const first = strikes[0], last = strikes[strikes.length - 1];
  const xOf = (scaled: number) => PAD_L + ((scaled - first) / (last - first)) * INNER_W;
  const idxOf = (scaled: number) => {
    let best = 0;
    for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i] - scaled) < Math.abs(strikes[best] - scaled)) best = i;
    return best;
  };

  const selIdx = idxOf(selected);
  const sel = points[selIdx];
  const hover = hoverIdx !== null && hoverIdx !== selIdx ? points[hoverIdx] : null;
  const spotX = spot && spot >= first && spot <= last ? xOf(spot) : null;

  const cents = (p: number) => `${Math.round(p * 100)}c`;
  const dollars = (scaled: number) => '$' + (scaled / FLOAT_SCALING).toLocaleString(undefined, { maximumFractionDigits: 0 });
  // keep point labels inside the plot near the edges
  const clampX = (x: number) => Math.max(PAD_L + 40, Math.min(W - PAD_R - 40, x));

  const idxFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const ratio = ((e.clientX - rect.left) / rect.width) * W;
    const t = Math.max(0, Math.min(1, (ratio - PAD_L) / INNER_W));
    return Math.round(t * (strikes.length - 1));
  };

  return (
    <div className="border border-white/[0.08] rounded bg-bg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">
          Strike Curve
        </h3>
        <span className="font-mono text-[10px] text-gray-500">
          every point is a market · <span className="text-white">{dollars(sel.strike)} · {cents(sel.prob)}</span>
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair select-none"
        onPointerMove={(e) => setHoverIdx(idxFromEvent(e))}
        onPointerLeave={() => setHoverIdx(null)}
        onClick={(e) => { const i = idxFromEvent(e as unknown as React.PointerEvent<SVGSVGElement>); if (i !== null) onSelect(strikes[i]); }}
      >
        <defs>
          <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.10} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* cents gridlines */}
        {[0.25, 0.5, 0.75].map((p) => (
          <g key={p}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={PAD_L - 8} y={y(p) + 3} textAnchor="end" fontSize={9} fill="#525252" fontFamily="monospace">{cents(p)}</text>
          </g>
        ))}

        {/* spot marker — the one vermilion line */}
        {spotX !== null && (
          <g>
            <line x1={spotX} x2={spotX} y1={PAD_T - 6} y2={H - PAD_B} stroke="#E04D26" strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.8} />
            <text x={clampX(spotX)} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} fill="#E04D26" fontFamily="monospace">
              spot {spot ? dollars(spot) : ''}
            </text>
          </g>
        )}

        {/* the curve */}
        <path d={area} fill="url(#curveFill)" />
        <path d={path} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round" />

        {/* hover ghost */}
        {hover && (
          <g>
            <circle cx={hover.x} cy={y(hover.prob)} r={4} fill="#000" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
            <text x={clampX(hover.x)} y={y(hover.prob) - 12} textAnchor="middle" fontSize={10} fill="#A3A3A3" fontFamily="monospace">
              {dollars(hover.strike)} · {cents(hover.prob)}
            </text>
          </g>
        )}

        {/* selected strike */}
        <g>
          <circle cx={sel.x} cy={y(sel.prob)} r={5.5} fill="#000" stroke="#FFFFFF" strokeWidth={2} />
          {!hover && (
            <text x={clampX(sel.x)} y={y(sel.prob) - 12} textAnchor="middle" fontSize={10} fill="#FFFFFF" fontWeight={600} fontFamily="monospace">
              {dollars(sel.strike)} · {cents(sel.prob)}
            </text>
          )}
        </g>

        {/* x-axis extremes */}
        <text x={PAD_L} y={H - PAD_B + 14} textAnchor="start" fontSize={9} fill="#525252" fontFamily="monospace">{dollars(first)}</text>
        <text x={W - PAD_R} y={H - PAD_B + 14} textAnchor="end" fontSize={9} fill="#525252" fontFamily="monospace">{dollars(last)}</text>
      </svg>

      <p className="text-[10px] text-gray-600 mt-1">
        Fair price of UP at each strike, from the live volatility surface. Click the curve to pick your strike.
      </p>
    </div>
  );
}
