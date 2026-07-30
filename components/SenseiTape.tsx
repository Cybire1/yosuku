'use client';

// The live price tape Sensei reads from — shared by BOTH Sensei surfaces (the floating
// dock drawer and the /sensei page) so there is one implementation of "what the market
// is doing right now" and both draw the SAME chart the rest of the site draws
// (drawPriceLine: gridlines, right-edge price axis, the UP line, verdict colour).
//
// Deliberately the real chart and not a hairline sparkline: Sensei's whole job is to give
// a read, and a read is only checkable if you can see the picture it was made from.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPythHistory624 } from '@/lib/sui/predict624Client';
import { drawPriceLine } from '@/lib/charts/canvasChart';

export type PricePt = { usd: number; tsMs: number };
export type Drift = { usd: number; spanMin: number; dir: 'up' | 'down' | 'flat' };

const DRIFT_WINDOW_MIN: Record<string, number> = { '1m': 1, '5m': 5, '1h': 15 };
const HIST_LIMIT: Record<string, number> = { '1m': 90, '5m': 300, '1h': 360 };

const REDUCE_MOTION =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Directional drift over the cadence window, measured on the SAME feed that settles
// markets. spanMin is the ACTUAL span held — it never overstates the window.
export function computeDrift(hist: PricePt[], cadence: string): Drift | null {
  if (!hist || hist.length < 2) return null;
  const windowMins = DRIFT_WINDOW_MIN[cadence] ?? 5;
  const latest = hist[hist.length - 1];
  const cutoff = latest.tsMs - windowMins * 60_000;
  let chosen = hist[0];
  for (let i = 0; i < hist.length; i++) { if (hist[i].tsMs >= cutoff) { chosen = hist[i]; break; } }
  const usd = latest.usd - chosen.usd;
  const spanMin = Math.max(0, Math.round((latest.tsMs - chosen.tsMs) / 60_000));
  const dir: Drift['dir'] = Math.abs(usd) <= 3 ? 'flat' : usd > 0 ? 'up' : 'down';
  return { usd, spanMin, dir };
}

/** Poll the settlement feed while `active`, and derive the drift for the cadence. */
export function usePythTape(active: boolean, cadence: string) {
  const [hist, setHist] = useState<PricePt[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = async () => {
      const h = await fetchPythHistory624(HIST_LIMIT[cadence] ?? 300).catch(() => null);
      if (alive && h && h.length) setHist(h); // keep last-good on a hiccup
    };
    load();
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [active, cadence]);

  const series = useMemo(() => hist.map((p) => p.usd), [hist]);
  const drift = useMemo(() => computeDrift(hist, cadence), [hist, cadence]);
  return { hist, series, drift };
}

/**
 * The chart itself. `upLine` is the market's UP line: price above it means UP is winning,
 * so the line paints green above and red below and the read answers "who's winning" before
 * a word is typed. Only animates while `active` — a hidden canvas measures 0 wide.
 */
export default function SenseiTape({
  series,
  upLine,
  active = true,
  bleed = true,
}: {
  series: number[];
  upLine: number | null;
  active?: boolean;
  /** Full-bleed past the container's padding (the drawer strip). Off for in-flow layouts. */
  bleed?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || series.length < 2) return;
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 560;
    const opts = {
      target: upLine ?? undefined,
      // Always label the line. On /markets the strike is repeated in the headline, so the
      // hero can drop its pill on phones — here it is stated nowhere else, and an
      // unexplained dashed line is just decoration. Narrow gets the short form.
      targetLabel: upLine == null ? '' : narrow ? `UP $${upLine.toLocaleString()}` : `UP line · $${upLine.toLocaleString()}`,
      verdict: true,
      gridLines: true,
      axisRight: narrow ? 46 : 56,
      padX: 14,
      padTop: 12,
      padBot: 12,
    };
    let raf = 0;
    const frame = (t: number) => {
      drawPriceLine(ref.current, series, REDUCE_MOTION ? opts : { ...opts, motion: true, now: t });
      if (!REDUCE_MOTION) raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [active, series, upLine]);

  if (series.length < 2) return <div className="sm-chart-empty">reading the market…</div>;
  return (
    <div className={`sm-chart-wrap${bleed ? '' : ' sm-chart-inset'}`}>
      <canvas ref={ref} className="sm-chart" aria-label="Live Bitcoin price against the UP line" />
    </div>
  );
}
