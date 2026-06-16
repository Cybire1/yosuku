'use client';

// The volatility SURFACE — Predict's most distinctive on-chain structure, made visible.
// Every binary on Predict is priced off a parametric SVI vol surface (Block Scholes feeds
// a, b, rho, m, sigma per oracle). The trade flow uses one strike; this page reads the WHOLE
// surface back: the smile (IV across strikes), the strike ladder (every strike priced), and
// the term structure (ATM IV across expiries). It turns "tap UP/DOWN" into "a real options
// venue you can inspect." All math (computeSviPrice / impliedVolAnnual) re-derives the
// on-chain quote and is chain-verified; the on-chain contract remains authoritative.
import { useState, useEffect, useRef, useMemo } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import { useOracles, useSviPricing, useOraclePrices } from '@/lib/sui/hooks';
import { fetchOracleState } from '@/lib/sui/predictApi';
import { sviSmile, computeSviPrice, atmImpliedVol, type SmilePoint } from '@/lib/sui/sviPricing';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { setupCanvas } from '@/lib/charts/canvasChart';

const VERM = '#E04D26';
const toMs = (t: number) => (t > 1e12 ? t : t * 1000);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const usd = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

interface TermPoint { oracleId: string; days: number; iv: number; }

/** Draw a single IV line series with a faint grid, y-axis (% vol) and x-axis labels, and an
 *  optional vertical marker (the forward / ATM). Self-contained so the page owns its look. */
function drawIvLine(
  canvas: HTMLCanvasElement,
  pts: { x: number; y: number }[],          // x in data units, y = iv fraction
  opts: { markerX?: number; xLabels?: { x: number; label: string }[]; xIsLog?: boolean },
) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (pts.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('awaiting surface…', w / 2, h / 2);
    return;
  }
  const padL = 44, padR = 14, padT = 14, padB = 24;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const padY = (yMax - yMin) * 0.15 || 0.05;
  yMin = Math.max(0, yMin - padY); yMax = yMax + padY;
  const X = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * (w - padL - padR);
  const Y = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (h - padT - padB);

  // y grid + labels (vol %)
  ctx.font = '9px monospace'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 3; i++) {
    const v = yMin + (i / 3) * (yMax - yMin);
    const y = Y(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.textAlign = 'right';
    ctx.fillText(`${(v * 100).toFixed(0)}%`, padL - 6, y);
  }
  // vertical marker (forward / ATM)
  if (opts.markerX !== undefined && opts.markerX >= xMin && opts.markerX <= xMax) {
    const mx = X(opts.markerX);
    ctx.strokeStyle = 'rgba(224,77,38,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, h - padB); ctx.stroke(); ctx.setLineDash([]);
  }
  // x labels
  if (opts.xLabels) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const l of opts.xLabels) {
      if (l.x < xMin || l.x > xMax) continue;
      ctx.fillText(l.label, X(l.x), h - padB + 6);
    }
  }
  // the IV curve
  ctx.strokeStyle = VERM; ctx.lineWidth = 1.8; ctx.beginPath();
  pts.forEach((p, i) => { const x = X(p.x), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  // endpoint dots
  ctx.fillStyle = VERM;
  for (const p of [pts[0], pts[pts.length - 1]]) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.2, 0, Math.PI * 2); ctx.fill(); }
}

export default function SurfacePage() {
  const { active, loading: oraclesLoading } = useOracles();
  const [asset, setAsset] = useState<string | null>(null);
  const [focalIdx, setFocalIdx] = useState(0);
  const smileRef = useRef<HTMLCanvasElement>(null);
  const termRef = useRef<HTMLCanvasElement>(null);
  const [termPoints, setTermPoints] = useState<TermPoint[]>([]);

  // assets present in the live oracle set
  const assets = useMemo(() => {
    const s = new Set<string>();
    for (const o of active) if (o.underlying_asset) s.add(o.underlying_asset);
    return Array.from(s);
  }, [active]);

  // default to the asset of the soonest-expiring oracle
  useEffect(() => {
    if (!asset && assets.length) {
      const soonest = active.slice().sort((a, b) => a.expiry - b.expiry)[0];
      setAsset(soonest?.underlying_asset ?? assets[0]);
    }
  }, [assets, asset, active]);

  // the selected asset's oracles, nearest expiry first
  const assetOracles = useMemo(
    () => active.filter((o) => o.underlying_asset === asset).sort((a, b) => a.expiry - b.expiry),
    [active, asset],
  );
  const focal = assetOracles[Math.min(focalIdx, Math.max(0, assetOracles.length - 1))] ?? null;
  useEffect(() => { setFocalIdx(0); }, [asset]);

  const { sviData } = useSviPricing(focal?.oracle_id ?? null);
  const { prices } = useOraclePrices(focal?.oracle_id ?? null);

  const forward = prices ? prices.forward / FLOAT_SCALING : 0;
  const secsToExpiry = focal ? Math.max(60, (toMs(focal.expiry) - Date.now()) / 1000) : 0;
  const days = secsToExpiry / 86400;

  const smile: SmilePoint[] = useMemo(() => {
    if (!sviData?.params || forward <= 0 || secsToExpiry <= 0) return [];
    return sviSmile(sviData.params, forward, secsToExpiry, { spanPct: 0.18, steps: 49 });
  }, [sviData, forward, secsToExpiry]);

  const atmIv = sviData?.params && forward > 0 ? atmImpliedVol(sviData.params, forward, secsToExpiry) : 0;

  // strike ladder rows (decimate the smile to ~11 rungs)
  const ladder = useMemo(() => {
    if (smile.length === 0) return [];
    const n = 11, out: SmilePoint[] = [];
    for (let i = 0; i < n; i++) out.push(smile[Math.round((i / (n - 1)) * (smile.length - 1))]);
    return out;
  }, [smile]);
  const atmStrike = useMemo(
    () => (ladder.length ? ladder.reduce((b, p) => (Math.abs(p.strike - forward) < Math.abs(b.strike - forward) ? p : b)) : null),
    [ladder, forward],
  );

  // term structure — ATM IV across every active oracle of the asset (one state fetch each)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (assetOracles.length === 0) { setTermPoints([]); return; }
      const pts = await Promise.all(assetOracles.map(async (o): Promise<TermPoint | null> => {
        try {
          const st = await fetchOracleState(o.oracle_id);
          const fwd = st?.latest_price ? st.latest_price.forward / FLOAT_SCALING : 0;
          const secs = Math.max(60, (toMs(o.expiry) - Date.now()) / 1000);
          if (!st?.latest_svi?.params || fwd <= 0) return null;
          return { oracleId: o.oracle_id, days: secs / 86400, iv: atmImpliedVol(st.latest_svi.params, fwd, secs) };
        } catch { return null; }
      }));
      if (!cancelled) setTermPoints(pts.filter((p): p is TermPoint => p !== null && p.iv > 0).sort((a, b) => a.days - b.days));
    })();
    return () => { cancelled = true; };
  }, [assetOracles]);

  // draw the smile
  useEffect(() => {
    if (!smileRef.current) return;
    drawIvLine(
      smileRef.current,
      smile.map((p) => ({ x: p.strike, y: p.iv })),
      {
        markerX: forward,
        xLabels: smile.length ? [smile[0], smile[Math.floor(smile.length / 2)], smile[smile.length - 1]].map((p) => ({ x: p.strike, label: usd(p.strike) })) : [],
      },
    );
  }, [smile, forward]);

  // draw the term structure
  useEffect(() => {
    if (!termRef.current) return;
    drawIvLine(
      termRef.current,
      termPoints.map((p) => ({ x: p.days, y: p.iv })),
      { xLabels: termPoints.map((p) => ({ x: p.days, label: `${p.days < 1 ? (p.days * 24).toFixed(0) + 'h' : p.days.toFixed(0) + 'd'}` })) },
    );
  }, [termPoints]);

  const loading = oraclesLoading && active.length === 0;
  const haveSurface = !!sviData?.params && forward > 0 && smile.length > 0;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-gray-500 mb-7 flex items-center gap-3">
          <a href="/" className="hover:text-white transition-colors">Yosuku</a>
          <span className="text-gray-700">/</span>
          <span className="text-white">Surface</span>
        </div>

        <h1 className="font-display font-[800] text-4xl text-white tracking-tight mb-2">Volatility Surface</h1>
        <p className="font-jp text-gray-500 text-sm mb-6">ボラティリティ・サーフェス</p>
        <p className="text-gray-400 text-sm leading-relaxed max-w-2xl mb-8">
          Every Predict market is priced off a live, on-chain <span className="text-white">SVI volatility surface</span>.
          The trade flow uses one strike — here you can read the whole surface back: the smile across strikes, every
          strike priced as an options ladder, and the term structure across expiries. The math re-derives the on-chain
          quote (the contract stays authoritative).
        </p>

        {/* asset + expiry selectors */}
        {assets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-8">
            {assets.map((a) => (
              <button
                key={a}
                onClick={() => setAsset(a)}
                className={`font-mono text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                  asset === a ? 'border-white/25 bg-white/10 text-white' : 'border-white/10 text-gray-500 hover:text-gray-300'
                }`}
              >
                {a}
              </button>
            ))}
            {assetOracles.length > 1 && (
              <>
                <span className="text-gray-700 mx-1">·</span>
                {assetOracles.map((o, i) => {
                  const d = Math.max(0, (toMs(o.expiry) - Date.now()) / 86400000);
                  return (
                    <button
                      key={o.oracle_id}
                      onClick={() => setFocalIdx(i)}
                      className={`font-mono text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                        focalIdx === i ? 'border-vermilion/40 text-vermilion' : 'border-white/10 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {d < 1 ? `${(d * 24).toFixed(0)}h` : `${d.toFixed(0)}d`}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="font-mono text-sm text-gray-500 py-20 text-center">reading the surface…</div>
        ) : assets.length === 0 ? (
          <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
            <p className="text-gray-500 text-sm max-w-sm mx-auto">No active markets right now — the surface populates when an oracle is live.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 01: surface readout */}
            <section>
              <SectionHeader number="01" title="Surface" jp="サーフェス" live meta={focal ? `${asset} · ${days < 1 ? (days * 24).toFixed(0) + 'h' : days.toFixed(0) + 'd'}` : ''} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Forward', forward > 0 ? usd(forward) : '—'],
                  ['ATM implied vol', atmIv > 0 ? pct(atmIv) : '—'],
                  ['Time to expiry', focal ? (days < 1 ? `${(days * 24).toFixed(1)}h` : `${days.toFixed(1)}d`) : '—'],
                  ['Live markets', String(assetOracles.length)],
                ].map(([label, value]) => (
                  <div key={label} className="border border-white/[0.08] rounded bg-bg p-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">{label}</div>
                    <div className="font-display text-2xl font-extrabold tracking-tight tabular-nums text-white">{value}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 02: the smile */}
            <section>
              <SectionHeader number="02" title="Volatility smile" jp="スマイル" desc="Implied vol across strikes for the selected round — the vermilion line marks the forward." />
              <div className="border border-white/[0.08] rounded bg-bg p-3" style={{ height: 220 }}>
                {haveSurface ? <canvas ref={smileRef} className="w-full h-full" /> : <div className="flex items-center justify-center h-full font-mono text-xs text-gray-600">no SVI surface for this round yet</div>}
              </div>
              {sviData?.params && (
                <div className="font-mono text-[10px] text-gray-600 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {(['a', 'b', 'rho', 'm', 'sigma'] as const).map((k) => (
                    <span key={k}>{k}=<span className="text-gray-400">{(sviData.params[k] / FLOAT_SCALING).toFixed(4)}</span></span>
                  ))}
                </div>
              )}
            </section>

            {/* 03: strike ladder */}
            <section>
              <SectionHeader number="03" title="Strike ladder" jp="ストライク" desc="Every strike priced off the surface — the options chain Predict exposes, not a single bet." />
              <div className="border border-white/[0.08] rounded bg-bg overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-5 py-2.5 border-b border-white/[0.06] font-mono text-[9px] uppercase tracking-[0.16em] text-gray-500">
                  <span>Strike</span><span className="text-right">UP price</span><span className="text-right">DOWN price</span><span className="text-right">Implied vol</span>
                </div>
                {ladder.length === 0 ? (
                  <div className="font-mono text-xs text-gray-600 px-5 py-8 text-center">surface loading…</div>
                ) : ladder.map((p, i) => {
                  const isAtm = atmStrike && p.strike === atmStrike.strike;
                  return (
                    <div key={i} className={`grid grid-cols-4 gap-2 px-5 py-2 text-[12px] font-mono tabular-nums transition-colors ${isAtm ? 'bg-vermilion/[0.06]' : 'hover:bg-white/[0.02]'}`}>
                      <span className={isAtm ? 'text-vermilion' : 'text-gray-300'}>{usd(p.strike)}{isAtm && <span className="text-[9px] ml-1.5 tracking-[0.1em]">ATM</span>}</span>
                      <span className="text-right text-emerald-400/90">{pct(p.prob)}</span>
                      <span className="text-right text-gray-400">{pct(1 - p.prob)}</span>
                      <span className="text-right text-gray-300">{pct(p.iv)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 04: term structure */}
            <section>
              <SectionHeader number="04" title="Term structure" jp="ターム" desc="At-the-money implied vol across the asset's live expiries." meta={`${termPoints.length} expir${termPoints.length === 1 ? 'y' : 'ies'}`} />
              <div className="border border-white/[0.08] rounded bg-bg p-3" style={{ height: 180 }}>
                {termPoints.length >= 2 ? (
                  <canvas ref={termRef} className="w-full h-full" />
                ) : (
                  <div className="flex items-center justify-center h-full font-mono text-xs text-gray-600">
                    {termPoints.length === 1 ? `single live expiry — ATM ${pct(termPoints[0].iv)} at ${termPoints[0].days < 1 ? (termPoints[0].days * 24).toFixed(0) + 'h' : termPoints[0].days.toFixed(0) + 'd'}` : 'need ≥2 live expiries for a curve'}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
