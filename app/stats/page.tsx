'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchTraction, type TractionStats, type Interaction, type GrowthPoint } from '@/lib/sui/traction';
import WaitlistCard from '@/components/WaitlistCard';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';

const SCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SCAN_ACC = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 });

function ago(ts: number): string {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const KIND_LABEL: Record<Interaction['kind'], string> = {
  onboard: 'onboarded · gas-free',
  waitlist: 'waitlist signup',
  'tweet-trade': 'tweet-trade',
  leverage: 'leveraged open',
  liquidation: 'liquidation',
  deposit: 'vault deposit',
};
const KIND_DOT: Record<Interaction['kind'], string> = {
  onboard: '#34d399',
  waitlist: '#a78bfa',
  'tweet-trade': '#22d3ee',
  leverage: 'var(--vermilion)',
  liquidation: '#f59e0b',
  deposit: '#60a5fa',
};

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`border rounded-2xl p-5 ${accent ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-white/[0.07] bg-[#0d0d10]'}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">{label}</div>
      <div className={`font-display text-3xl font-extrabold tracking-tight tabular-nums ${accent ? 'text-emerald-300' : ''}`}>{value}</div>
      {sub && <div className="font-mono text-[11px] text-gray-600 mt-1">{sub}</div>}
    </div>
  );
}

// The cumulative onboarded-users curve — the slope IS the story. Honest: a single point
// renders as a dot, two+ as a glowing line with a gradient fill. No fabricated smoothing.
function GrowthCurve({ points, height = 200 }: { points: GrowthPoint[]; height?: number }) {
  const W = 920, H = height, padX = 16, padT = 22, padB = 26;
  if (points.length === 0) {
    return <div className="font-mono text-[11px] text-gray-600 py-16 text-center">your growth curve starts with the first sponsored signup — drive one and watch it climb.</div>;
  }
  const max = Math.max(1, ...points.map((p) => p.cumulative));
  const xAt = (i: number) => points.length === 1 ? W / 2 : padX + (i / (points.length - 1)) * (W - 2 * padX);
  const yAt = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const pts = points.map((p, i) => ({ x: xAt(i), y: yAt(p.cumulative), p }));
  const line = pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  const lastX = points.length === 1 ? W / 2 : W - padX;
  const area = `${padX},${H - padB} ${line} ${lastX.toFixed(1)},${H - padB}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(52,211,153,0.28)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={padX} x2={W - padX} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
      ))}
      <polygon points={area} fill="url(#gc)" stroke="none" />
      {pts.length > 1 && <polyline points={line} fill="none" stroke="#34d399" strokeWidth={2.5} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(52,211,153,0.55))' }} />}
      {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={i === pts.length - 1 ? 5 : 3} fill="#34d399" style={i === pts.length - 1 ? { filter: 'drop-shadow(0 0 8px #34d399)' } : undefined} />)}
      <text x={padX} y={14} className="fill-gray-600" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 2 }}>CUMULATIVE WALLETS ONBOARDED</text>
      <text x={W - padX} y={14} textAnchor="end" className="fill-emerald-300" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{max}</text>
    </svg>
  );
}

export default function StatsPage() {
  const [t, setT] = useState<TractionStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setT(await fetchTraction()); } catch { /* keep last */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      {/* ── HERO: the 5-second answer to "can they get users?" ── */}
      <section className="page-hero">
        <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
        <span className="hero-meta tl">PROOF · 実証<span className="ln">LIVE ON-CHAIN</span></span>
        <span className="hero-meta tr">EDITION 04 / 2026<span className="ln">SUI · TESTNET</span></span>
        <span className="hero-meta bl">VERIFIABLE<span className="ln">NOTHING SELF-REPORTED</span></span>
        <span className="hero-meta br">{t ? `UPDATED ${ago(t.updatedAt)}` : 'LIVE'}<span className="ln">AUTO · 30s</span></span>

        <div className="container">
          <div className="breadcrumb">
            <a href="/" data-cursor="hover">Home</a>
            <span className="sep">/</span>
            <span style={{ color: 'var(--white)' }}>Proof</span>
          </div>

          <div className="hero-grid">
            <div className="hero-left">
              <div className="eyebrow">
                <span className="dash" />
                <span className="live-dot" />
                <span>Live · on-chain · verifiable</span>
              </div>
              <h1 className="page-title">
                Proof of<br /><span className="accent">demand</span>.
              </h1>
              <p className="page-title-jp">実需の証明</p>
              <p className="mt-6 max-w-md text-gray-400 leading-relaxed text-[15px]">
                Real wallets, read straight from the chain. Yosuku <span className="text-gray-200">paid their gas</span> — so the chain itself
                proves each one came through us, not the broader Predict network. Every number links to Suiscan.
              </p>
            </div>

            {/* headline metric card */}
            <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.07] to-transparent p-7 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 10px #34d399' }} />
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gray-500">Wallets onboarded</span>
              </div>
              <div className="font-display text-[88px] leading-none font-extrabold tracking-tighter text-emerald-300 tabular-nums" style={{ textShadow: '0 0 40px rgba(52,211,153,0.35)' }}>
                {t ? fmt(t.onboardedUsers) : '—'}
              </div>
              <div className="font-mono text-[11px] text-emerald-400/80 mt-2 mb-5">gas paid by Yosuku · un-fakeable</div>
              <div className="border-t border-white/[0.07] pt-4 grid grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-600">Waitlist</div>
                  <div className="font-mono text-lg font-bold tabular-nums">{t ? fmt(t.waitlistSignups) : '—'}</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-600">Gas-free actions</div>
                  <div className="font-mono text-lg font-bold tabular-nums">{t ? fmt(t.sponsoredActions) : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* takedown notice — honest + transparent */}
      <div className="container">
        <div className="max-w-5xl mx-auto -mt-2 mb-10">
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-2.5">
            <span className="text-amber-400 text-sm">⏳</span>
            <span className="font-mono text-[11px] text-amber-200/90 tracking-wide">
              This proof page is live for <span className="text-amber-100">Sui Overflow 2026 judging</span> and will be taken down afterward.
            </span>
          </div>
        </div>
      </div>

      <main className="container pb-12">
        <div className="max-w-5xl mx-auto">
          {loading && !t ? (
            <div className="font-mono text-sm text-gray-500 py-20 text-center">reading the chain…</div>
          ) : t ? (
            <>
              {/* ── 01 · GROWTH (the centerpiece) ── */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-[11px] text-vermilion font-bold">01</span>
                <h2 className="font-display text-lg font-bold">Growth</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">cumulative · who showed up</span>
              </div>
              <div className="border border-white/[0.07] rounded-2xl bg-gradient-to-b from-[#0e1310] to-[#0d0d10] p-5 mb-10">
                <GrowthCurve points={t.growth} />
              </div>

              {/* ── 02 · ADOPTION ── */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-[11px] text-vermilion font-bold">02</span>
                <h2 className="font-display text-lg font-bold">Adoption</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">real users · attributable</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <Stat label="Wallets onboarded" value={fmt(t.onboardedUsers)} sub="gas paid by Yosuku — provably ours" accent />
                <Stat label="Waitlist signups" value={fmt(t.waitlistSignups)} sub="signed on-chain" />
                <Stat label="Gas-free actions" value={fmt(t.sponsoredActions)} sub="Yosuku sponsored the gas" />
              </div>
              <p className="font-mono text-[11px] text-gray-600 mb-10 leading-relaxed max-w-2xl">
                Every wallet here had its gas <span className="text-gray-400">paid by Yosuku&apos;s sponsor</span> — the chain records us as sponsor,
                so each provably came through Yosuku (web or mobile), not the broader Predict network. Our own infra/test wallets are excluded.
              </p>

              {/* ── 03 · CAPABILITY (engine proven) ── */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-[11px] text-vermilion font-bold">03</span>
                <h2 className="font-display text-lg font-bold">Capability, proven on-chain</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Stat label="Tweet-trades" value={fmt(t.proven.tweetTrades)} sub="un-drainable" />
                <Stat label="Leveraged opens" value={fmt(t.proven.leverageOpens)} sub="margin desk" />
                <Stat label="Liquidations" value={fmt(t.proven.liquidations)} sub="agent-executed (in TEE)" />
                <Stat label="Volume" value={fmt(t.proven.volumeDusdc)} sub="DUSDC notional" />
              </div>
              <p className="font-mono text-[11px] text-gray-600 mb-10 leading-relaxed max-w-2xl">
                The machine works, proven on real testnet transactions — <span className="text-gray-400">this includes our own demo/test runs.</span>
                It demonstrates capability (the attested agent, no-divert custody, the liquidation engine), not user volume.
              </p>

              {/* ── 04 · DEMAND PIPELINE (waitlist) ── */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-[11px] text-vermilion font-bold">04</span>
                <h2 className="font-display text-lg font-bold">The demand pipeline</h2>
              </div>
              <div className="mb-10">
                <WaitlistCard />
              </div>

              {/* ── 05 · LIVE ACTIVITY (verify it yourself) ── */}
              <div className="flex items-baseline justify-between mb-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-vermilion font-bold">05</span>
                  <h2 className="font-display text-lg font-bold">Live activity</h2>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">click any row → Suiscan</span>
                </div>
                <span className="font-mono text-[10px] text-gray-600">updated {ago(t.updatedAt)}</span>
              </div>
              <div className="border border-white/[0.07] rounded-2xl bg-[#0d0d10] divide-y divide-white/[0.05] overflow-hidden">
                {t.recent.length === 0 && (
                  <div className="font-mono text-xs text-gray-500 px-5 py-8 text-center">no activity indexed yet</div>
                )}
                {t.recent.map((r, i) => {
                  const inner = (
                    <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[r.kind], boxShadow: `0 0 8px ${KIND_DOT[r.kind]}` }} />
                      <span className="font-mono text-[12px] text-gray-300 w-36 shrink-0">{KIND_LABEL[r.kind]}</span>
                      <a
                        href={SCAN_ACC(r.user)} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-[12px] text-gray-500 hover:text-white transition-colors"
                      >{short(r.user)}</a>
                      <span className="flex-1" />
                      {r.amount > 0 && <span className="font-mono text-[12px] text-gray-300 tabular-nums">{fmt(r.amount)} DUSDC</span>}
                      <span className="font-mono text-[11px] text-gray-600 w-16 text-right shrink-0">{ago(r.ts)}</span>
                      <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{r.digest ? '↗' : ''}</span>
                    </div>
                  );
                  const txHref = r.digest ? SCAN_TX(r.digest) : null;
                  return txHref ? (
                    <div
                      key={i}
                      role="link"
                      tabIndex={0}
                      onClick={() => window.open(txHref, '_blank', 'noopener,noreferrer')}
                      onKeyDown={(e) => { if (e.key === 'Enter') window.open(txHref, '_blank', 'noopener,noreferrer'); }}
                      className="block cursor-pointer"
                    >{inner}</div>
                  ) : (
                    <div key={i}>{inner}</div>
                  );
                })}
              </div>

              <p className="font-mono text-[11px] text-gray-600 mt-5 leading-relaxed">
                Adoption reads Yosuku&apos;s <span className="text-gray-400">Onara gas-sponsor</span> ledger + the on-chain{' '}
                <span className="text-gray-400">waitlist</span>; capability reads <span className="text-gray-400">social_vault</span>,{' '}
                <span className="text-gray-400">margin</span> and <span className="text-gray-400">underwrite</span> events — all via Sui GraphQL.
                Testnet today; the same surface carries to mainnet at launch. Live for Sui Overflow 2026 judging; taken down afterward.
              </p>
            </>
          ) : (
            <div className="font-mono text-sm text-rose-400 py-20 text-center">couldn&apos;t reach the chain — retrying…</div>
          )}
        </div>
        <Footer />
      </main>
    </div>
  );
}
