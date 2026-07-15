'use client';

// /feed — the reel. A full-screen vertical snap feed of live 6-24 rounds where
// the CHART is the hero of every card (built on the original chart-forward reel
// design, rewired to the real venue). One framed portrait card per round: the
// question, the live settlement tape as a big area chart with the win-line
// drawn, a real countdown, and one-tap UP/DOWN into the market. Swipe up →
// the next round snaps in. Everything is real — the markets, the pyth tape, the
// win-line the ticket actually buys (spot − $20). No fabricated odds. Betting
// happens on /markets; the buttons route there.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import { drawPriceLine } from '@/lib/charts/canvasChart';
import {
  fetchMarkets624,
  fetchSpot624,
  fetchPythHistory624,
  type Cadence624,
  type Market624,
} from '@/lib/sui/predict624Client';
import { BAND_USD, minMintMs } from '@/lib/sui/ticket624';
import { fmtBell624 } from '@/lib/sui/bell624';
import { fetchTakes, type FeedTake } from '@/lib/sui/takeBoard';
import TakeReelCard from '@/components/TakeReelCard';
import TakeComposer624 from '@/components/TakeComposer624';
import { Feather } from 'lucide-react';

const CAD_WORD: Record<Cadence624, string> = { '1m': '1-min', '5m': '5-min', '1h': '1-hour' };

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const usd2 = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clockHM = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

// Weave community takes into the live-market reel so the snap scroll (the moat)
// is one stream of actionable bells + social calls: market, take, market, take…
// then whichever list has a tail. Starting on a live market keeps the first card
// actionable.
type ReelItem = { kind: 'market'; market: Market624 } | { kind: 'take'; take: FeedTake };
function weaveReel(rounds: Market624[], takes: FeedTake[]): ReelItem[] {
  const out: ReelItem[] = [];
  const max = Math.max(rounds.length, takes.length);
  for (let i = 0; i < max; i++) {
    if (i < rounds.length) out.push({ kind: 'market', market: rounds[i] });
    if (i < takes.length) out.push({ kind: 'take', take: takes[i] });
  }
  return out;
}

// ─── one reel — a framed portrait card, chart as the hero ───

function ReelCard({
  market,
  spot,
  series,
  now,
}: {
  market: Market624;
  spot: number | null;
  series: number[];
  now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const visibleRef = useRef(true);

  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : null;
  const closing = msLeft != null && msLeft <= minMintMs(market.cadence);

  // Freeze the win-line per market at first sight of the round, so the
  // "distance to the line" reads as a real moving number, not a constant.
  const frozen = useRef<{ id: string; line: number } | null>(null);
  if (spot != null && frozen.current?.id !== market.id) {
    frozen.current = { id: market.id, line: Math.round(spot - BAND_USD) };
  }
  const line = frozen.current?.id === market.id ? frozen.current.line : null;

  // Only the on-screen card runs the animated tape (rAF); off-screen cards draw once.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting; }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || series.length < 2) return;
    const base = {
      target: line ?? undefined,
      targetLabel: line != null ? `win line · ${usd0(line)}` : undefined,
      color: '#E04D26',
      gridLines: true,
      axisRight: 58,
      padX: 14,
      padTop: 14,
      padBot: 14,
    };
    let raf = 0;
    const draw = (t: number) => {
      if (!canvasRef.current) return;
      drawPriceLine(canvasRef.current, series, visibleRef.current ? { ...base, motion: true, now: t } : base);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [series, line]);

  const above = spot != null && line != null && spot >= line;

  return (
    <section ref={cardRef} className="feed-card flex items-center justify-center px-3 pt-2 pb-[92px]">
      {/* the reel — framed portrait card floating on the near-black ground */}
      <div className="relative z-10 flex h-full w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-white/[0.1] shadow-[0_30px_120px_-30px_rgba(0,0,0,0.9)]"
        style={{ background: 'radial-gradient(130% 80% at 50% -8%, #16110d 0%, #0c0a08 44%, #080605 100%)' }}
      >
        {/* film grain + a top hairline of heat */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-30 opacity-[0.05] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")" }} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/50 to-transparent" />
        {/* ghost kanji */}
        <span aria-hidden className="pointer-events-none absolute -right-5 top-16 z-0 select-none font-jp text-[150px] font-bold leading-none text-white/[0.022]">賭</span>

        {/* top meta */}
        <div className="relative z-10 flex items-start justify-between px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-vermilion/40 font-mono text-[15px] text-vermilion">₿</span>
            <div className="leading-tight">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">BTC · oracle-settled</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">{CAD_WORD[market.cadence]} round · closes {clockHM(market.expiry)}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/40">closes in</div>
            <div className={`font-display text-2xl font-extrabold tabular-nums leading-none ${closing ? 'text-vermilion' : 'text-white'}`}>
              {msLeft != null ? fmtBell624(msLeft) : '—'}
            </div>
          </div>
        </div>

        {/* the take */}
        <div className="relative z-10 px-5 pt-4">
          <h2 className="font-display text-[26px] font-extrabold leading-[1.06] tracking-tight text-white">
            Will BTC be above{' '}
            {line != null ? <span className="text-vermilion">{usd0(line)}</span> : <span className="text-white/40">—</span>}
            <span className="text-white/85">?</span>
          </h2>
          <div className="mt-2 flex items-baseline gap-2.5 font-mono text-[12px] tabular-nums">
            <span className="text-white">{spot != null ? usd2(spot) : '—'}</span>
            {spot != null && line != null && (
              <span className={above ? 'text-vermilion' : 'text-white/45'}>
                {above ? `+$${Math.round(spot - line)}` : `−$${Math.round(line - spot)}`} vs line
              </span>
            )}
            <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">live oracle</span>
          </div>
        </div>

        {/* the chart — the hero, fills the middle */}
        <div className="relative z-10 mt-2 min-h-0 flex-1 px-1.5">
          {series.length > 1 ? (
            <canvas ref={canvasRef} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">reading the tape…</div>
          )}
        </div>

        {/* one-tap — honest, routes to the market */}
        <div className="relative z-10 px-5 pb-6 pt-2">
          {closing ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] py-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
              closing — the next round is already rolling
            </div>
          ) : (
            <>
              <div className="mb-2.5 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">winning side pays $1 · settled by the oracle at close</div>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/markets" data-cursor="hover" style={{ outline: 'none' }}
                  className="rounded-xl border border-vermilion/60 bg-vermilion/10 py-3 text-center font-display text-base font-bold text-vermilion transition-colors hover:bg-vermilion/20">
                  UP
                </Link>
                <Link href="/markets" data-cursor="hover" style={{ outline: 'none' }}
                  className="rounded-xl border border-white/15 bg-white/[0.02] py-3 text-center font-display text-base font-bold text-white/80 transition-colors hover:border-white/30 hover:text-white">
                  DOWN
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── the page ───

function EmptyReel({ children }: { children: ReactNode }) {
  return (
    <section className="feed-card flex items-center justify-center px-3 pt-2 pb-[92px]">
      <div className="relative z-10 flex h-full w-full max-w-[460px] flex-col items-center justify-center gap-3.5 rounded-[26px] border border-white/[0.1] bg-[#0a0807] text-center">
        <span aria-hidden className="font-jp text-[40px] text-white/10">賭</span>
        <div className="font-display text-xl font-bold text-white">{children}</div>
        {/* motion cue so the state reads as live/working, never frozen */}
        <div aria-hidden className="mt-0.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-vermilion" style={{ animation: 'pulseDot 1.2s ease-in-out infinite' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-vermilion" style={{ animation: 'pulseDot 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-vermilion" style={{ animation: 'pulseDot 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
        </div>
      </div>
    </section>
  );
}

export default function FeedPage() {
  // 1s clock
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // live 6-24 markets (poll 15s) — success gates the deck so a failed read never drops the rounds
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const all = await fetchMarkets624();
        if (!dead) { setMarkets(all); setLoaded(true); }
      } catch { /* keep last good */ }
    };
    load();
    const iv = setInterval(load, 15_000);
    const t = setTimeout(() => { if (!dead) setLoaded(true); }, 8_000);
    return () => { dead = true; clearInterval(iv); clearTimeout(t); };
  }, []);

  // settlement-feed spot (poll 5s)
  const [spot, setSpot] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    const load = async () => { try { const s = await fetchSpot624(); if (!dead) setSpot(s); } catch { /* keep */ } };
    load();
    const iv = setInterval(load, 5_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  // ~2.5 min of the settlement tape for the round charts (poll 15s)
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let dead = false;
    const load = async () => { try { const h = await fetchPythHistory624(150); if (!dead && h.length > 5) setSeries(h.map((x) => x.usd)); } catch { /* keep */ } };
    load();
    const iv = setInterval(load, 15_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);
  const liveSeries = useMemo(() => (spot != null && series.length > 1 ? [...series, spot] : series), [series, spot]);

  // community takes (poll 20s) — the social half of the reel
  const [takes, setTakes] = useState<FeedTake[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const reloadTakes = useMemo(
    () => () => { fetchTakes(30).then(setTakes).catch(() => {}); },
    [],
  );
  useEffect(() => {
    reloadTakes();
    const iv = setInterval(reloadTakes, 20_000);
    return () => clearInterval(iv);
  }, [reloadTakes]);

  // enterable rounds, soonest bell first
  const rounds = useMemo(() => {
    const nowMs = now || Date.now();
    return markets
      .filter((m) => m.expiry - nowMs > minMintMs(m.cadence) * 0.6)
      .sort((a, b) => a.expiry - b.expiry);
  }, [markets, now]);

  const reel = useMemo(() => weaveReel(rounds, takes), [rounds, takes]);

  // The Take pill only makes sense once there's a live card/take to attach to.
  // Hiding it on the load/empty screen keeps UP/DOWN (predict BTC) as the first
  // action a viewer meets, not "write a take."
  const hasReel = loaded && reel.length > 0;

  return (
    <>
      <Marquee />
      <Header />
      <main className="feed-snap" style={{ outline: 'none' }}>
        {!loaded ? (
          <EmptyReel>reading the market…</EmptyReel>
        ) : reel.length === 0 ? (
          <EmptyReel>between rounds — a new one rolls every minute.</EmptyReel>
        ) : (
          reel.map((item) =>
            item.kind === 'market' ? (
              <ReelCard key={item.market.id} market={item.market} spot={spot} series={liveSeries} now={now} />
            ) : (
              <TakeReelCard key={`take-${item.take.blobId}-${item.take.tsMs}`} take={item.take} />
            ),
          )
        )}
      </main>

      {/* Post a take — the social entry point. Anchored on the RIGHT RAIL, mid-card
          (TikTok-style), so it never covers a card's bottom action row (UP/DOWN on
          a market, "take the other side" on a take). Icon + label pill. */}
      {hasReel && (
        <button
          onClick={() => setComposerOpen(true)}
          aria-label="Post a take"
          data-cursor="hover"
          style={{ outline: 'none' }}
          className="fixed right-4 top-1/2 z-40 inline-flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl bg-vermilion px-5 py-4 text-white shadow-[0_12px_32px_-10px_rgba(224,77,38,0.55)] transition-colors hover:bg-vermilion-d"
        >
          <Feather size={24} />
          <span className="font-display text-[13px] font-bold leading-none">Take</span>
        </button>
      )}

      {composerOpen && <TakeComposer624 onClose={() => setComposerOpen(false)} onPosted={reloadTakes} />}
    </>
  );
}
