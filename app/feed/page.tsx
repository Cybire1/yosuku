'use client';

// /feed — the live tape of the 6-24 venue, mobile-first and editorial.
//
// Everything on this page is REAL: live (future-expiry) markets straight from
// the DeepBook Predict beta indexer, the settlement pyth spot, the UP line the
// ticket actually buys (spot − $20 cushion), and the oracle settlement prints.
// No fabricated odds, no placeholder volume — if a number isn't real it isn't
// rendered. Betting happens on /markets (the founder-validated ticket drawer);
// every CTA here routes there. The old "Post a take" composer deep-linked into
// the RETIRED 4-16 venue, so it's gone.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import { drawPriceLine } from '@/lib/charts/canvasChart';
import {
  fetchMarkets624,
  fetchSpot624,
  fetchPythHistory624,
  type Cadence624,
  type Market624,
} from '@/lib/sui/predict624Client';
import { BAND_USD, minMintMs } from '@/lib/sui/ticket624';
import { fetchRecentPrints624, fmtBell624, type Print624 } from '@/lib/sui/bell624';

const CAD_WORD: Record<Cadence624, string> = { '1m': '1-min', '5m': '5-min', '1h': '1-hr' };

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const usd2 = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clockHM = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

// ─── small editorial section head — folio · title · kanji · meta ───

function RailHead({ folio, title, jp, meta }: { folio: string; title: string; jp?: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <span className="font-mono text-[10px] tabular-nums text-vermilion">{folio}</span>
      <h3 className="font-display text-[15px] font-bold tracking-tight text-white">{title}</h3>
      {jp && <span className="font-jp text-[11px] text-gray-500">{jp}</span>}
      {meta && (
        <span className="ml-auto whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.16em] text-gray-600">
          {meta}
        </span>
      )}
    </div>
  );
}

// ─── the hero card — the soonest market you can still enter ───

function HeroCard({
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
  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : null;
  const closing = msLeft != null && msLeft <= minMintMs(market.cadence);
  // FREEZE the line per market: recomputing it from live spot every render made the
  // "±$N vs the line" stat a constant $20 dressed up as signal. Locked to the spot at
  // first sight of the market, the distance becomes a genuinely moving number.
  const frozen = useRef<{ id: string; line: number } | null>(null);
  if (spot != null && frozen.current?.id !== market.id) {
    frozen.current = { id: market.id, line: Math.round(spot - BAND_USD) };
  }
  const line = frozen.current?.id === market.id ? frozen.current.line : null;

  useEffect(() => {
    if (!canvasRef.current || series.length < 2) return;
    let raf = 0;
    const draw = (t: number) => {
      if (!canvasRef.current) return;
      drawPriceLine(canvasRef.current, series, {
        target: line ?? undefined,
        targetLabel: line != null ? `up line · ${usd0(line)}` : undefined,
        color: '#E04D26',
        gridLines: true,
        axisRight: 54,
        padX: 10,
        padTop: 10,
        padBot: 10,
        motion: true,
        now: t,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [series, line]);

  return (
    <article className="relative overflow-hidden rounded-xl border border-white/[0.09] bg-white/[0.02]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgba(224,77,38,0.07), transparent 62%)' }}
      />
      <div className="relative p-5 sm:p-6">
        {/* head — round chip + bell time | countdown */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-vermilion/25 bg-vermilion/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion">
              <span className="h-1 w-1 animate-pulse rounded-full bg-vermilion" />
              {CAD_WORD[market.cadence]} round
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600">
              bell {clockHM(market.expiry)}
            </span>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-gray-600">to the bell</div>
            <div
              className={`mt-0.5 font-mono text-[26px] font-semibold leading-none tabular-nums ${
                closing ? 'text-vermilion' : 'text-white'
              }`}
            >
              {msLeft != null ? fmtBell624(msLeft) : '—'}
            </div>
          </div>
        </div>

        {/* the question — the UP ticket's real line right now */}
        <h2 className="mt-4 font-display text-[22px] font-extrabold leading-[1.12] tracking-tight text-white sm:text-[26px]">
          {line != null ? (
            <>
              BTC above <span className="text-vermilion">{usd0(line)}</span> at the bell?
            </>
          ) : (
            <span className="text-gray-500">Reading the settlement feed…</span>
          )}
        </h2>

        {/* the tape */}
        <div className="mt-3 h-[120px] sm:h-[150px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>

        {/* real numbers only */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
          <span>
            <span className="text-gray-600">SPOT </span>
            <span className="text-white">{spot != null ? usd2(spot) : '—'}</span>
          </span>
          <span>
            <span className="text-gray-600">UP LINE </span>
            <span className="text-gray-300">{line != null ? usd0(line) : '—'}</span>
          </span>
          {spot != null && line != null && (
            <span className={spot >= line ? 'text-vermilion' : 'text-gray-500'}>
              {spot >= line
                ? `+$${Math.round(spot - line)} above the line`
                : `−$${Math.round(line - spot)} below the line`}
            </span>
          )}
        </div>

        {/* CTA — the bet itself lives on /markets */}
        {closing ? (
          <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">
            closing — the next round is already rolling
          </div>
        ) : (
          <Link
            href="/markets"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-vermilion py-3.5 font-display text-[15px] font-bold text-white transition-colors hover:bg-vermilion-d"
            style={{ outline: 'none' }}
            data-cursor="hover"
          >
            Take a side <span aria-hidden>→</span>
          </Link>
        )}
        <p className="mt-2.5 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600">
          up · down · range on the ticket — oracle-settled, testnet funds
        </p>
      </div>
    </article>
  );
}

// ─── page ───

export default function FeedPage() {
  // 1s clock
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // live 6-24 markets (poll 15s)
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [marketsErr, setMarketsErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const all = await fetchMarkets624();
        if (!dead) {
          setMarkets(all);
          setMarketsErr(null);
        }
      } catch (e) {
        if (!dead) setMarketsErr(String(e instanceof Error ? e.message : e).slice(0, 120));
      } finally {
        if (!dead) setLoaded(true);
      }
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, []);

  // settlement-feed spot (poll 5s)
  const [spot, setSpot] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const s = await fetchSpot624();
        if (!dead) setSpot(s);
      } catch {
        /* keep last good spot */
      }
    };
    load();
    const iv = setInterval(load, 5_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, []);

  // ~2.5 min of the settlement tape for the hero chart (poll 15s)
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const h = await fetchPythHistory624(150);
        if (!dead && h.length > 5) setSeries(h.map((x) => x.usd));
      } catch {
        /* keep last series */
      }
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, []);
  const liveSeries = useMemo(
    () => (spot != null && series.length > 1 ? [...series, spot] : series),
    [series, spot],
  );

  // recent settlement prints (poll 20s; each print fetched once, then cached)
  const [prints, setPrints] = useState<Print624[]>([]);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const p = await fetchRecentPrints624(8); // one extra so the oldest visible row still has a prior for its delta
        if (!dead && p.length) setPrints(p);
      } catch {
        /* keep last prints */
      }
    };
    load();
    const iv = setInterval(load, 20_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, []);

  // future-only against the ticking clock; soonest first (fetch order preserved)
  const live = useMemo(
    () => markets.filter((m) => now === 0 || m.expiry > now),
    [markets, now],
  );
  // the hero = the soonest market you can still enter
  const hero = useMemo(
    () => live.find((m) => now === 0 || m.expiry - now > minMintMs(m.cadence)) ?? null,
    [live, now],
  );
  const ladder = useMemo(() => live.filter((m) => m.id !== hero?.id).slice(0, 7), [live, hero]);

  return (
    <div className="relative min-h-screen">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="mx-auto w-full max-w-[1080px] px-5 pb-[128px] pt-[96px] sm:px-8 sm:pt-[124px] lg:pb-24">
        {/* masthead */}
        <div className="border-b border-white/[0.08] pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5 font-mono text-[9px] uppercase tracking-[0.24em] text-gray-500">
              <span className="text-vermilion">The feed</span>
              <span aria-hidden>·</span>
              <span className="font-jp text-[11px] normal-case tracking-normal text-gray-400">予測の帳</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-gray-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vermilion" />
              DeepBook Predict · testnet
            </div>
          </div>
          <h1 className="mt-2 font-display text-[30px] font-extrabold leading-none tracking-tight text-white sm:text-4xl">
            Live at the bell<span className="text-vermilion">.</span>
          </h1>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
          {/* left — the clock + the ladder */}
          <div className="min-w-0">
            <RailHead
              folio="01"
              title="On the clock"
              jp="開催中"
              meta={live.length > 0 ? `${live.length} live` : undefined}
            />

            {!loaded ? (
              <div className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-gray-500">
                reading the tape…
              </div>
            ) : hero ? (
              <HeroCard market={hero} spot={spot} series={liveSeries} now={now} />
            ) : (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center">
                <div className="font-jp text-4xl text-gray-700">鐘</div>
                <h2 className="mt-3 font-display text-xl font-extrabold text-white">Between bells.</h2>
                <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-relaxed text-gray-400">
                  Markets roll every minute — check back in a moment.
                </p>
                <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">
                  {marketsErr ? 'feed unreachable · retrying every 15s' : 'refreshing automatically'}
                </p>
              </div>
            )}

            {ladder.length > 0 && (
              <section className="mt-8">
                <RailHead folio="02" title="Later bells" jp="後の鐘" meta="tap a row to trade" />
                <div className="border-t border-white/[0.08]">
                  {ladder.map((m, i) => {
                    const msLeft = now > 0 ? Math.max(0, m.expiry - now) : null;
                    const urgent = msLeft != null && msLeft < 60_000;
                    return (
                      <Link
                        key={m.id}
                        href="/markets"
                        className="group flex items-baseline gap-3 border-b border-white/[0.06] px-1 py-3 transition-colors hover:bg-white/[0.02]"
                        style={{ outline: 'none' }}
                        data-cursor="hover"
                      >
                        <span className="w-6 font-mono text-[10px] tabular-nums text-gray-600">
                          {String(i + 2).padStart(2, '0')}
                        </span>
                        <span className="w-14 font-mono text-[10px] uppercase tracking-[0.16em] text-gray-300">
                          {CAD_WORD[m.cadence]}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
                          bell {clockHM(m.expiry)}
                        </span>
                        <span
                          className={`ml-auto font-mono text-[13px] tabular-nums ${
                            urgent ? 'text-vermilion' : 'text-white'
                          }`}
                        >
                          {msLeft != null ? fmtBell624(msLeft) : '—'}
                        </span>
                        <span className="font-mono text-[11px] text-gray-600 transition-colors group-hover:text-vermilion">
                          →
                        </span>
                      </Link>
                    );
                  })}
                </div>
                <p className="mt-2.5 font-mono text-[9px] leading-relaxed text-gray-600">
                  Every bell is one rolling BTC market — the line is set when you take the ticket.
                </p>
              </section>
            )}
          </div>

          {/* right — the results rail: real oracle settlement prints */}
          <aside className="min-w-0">
            <RailHead folio="03" title="Settlement prints" jp="決算" meta="newest first" />
            {prints.length === 0 ? (
              <p className="border-t border-white/[0.08] py-6 font-mono text-[10px] uppercase tracking-[0.16em] text-gray-600">
                waiting for the next print…
              </p>
            ) : (
              <div className="border-t border-white/[0.08]">
                {prints.slice(0, 7).map((p, i) => {
                  const prev = prints[i + 1];
                  const d = prev ? p.priceUsd - prev.priceUsd : null;
                  return (
                    <div key={p.marketId} className="flex items-baseline gap-3 border-b border-white/[0.05] py-2.5">
                      <span className="font-mono text-[10px] tabular-nums text-gray-600">{clockHM(p.expiry)}</span>
                      <span className="w-10 font-mono text-[9px] uppercase tracking-[0.14em] text-gray-500">
                        {CAD_WORD[p.cadence]}
                      </span>
                      <span className="ml-auto font-mono text-[13px] tabular-nums text-gray-100">
                        {usd2(p.priceUsd)}
                      </span>
                      <span
                        className={`w-16 text-right font-mono text-[10px] tabular-nums ${
                          d == null ? 'text-gray-700' : d >= 0 ? 'text-vermilion' : 'text-gray-500'
                        }`}
                      >
                        {d == null ? '—' : `${d >= 0 ? '▲' : '▽'} ${Math.abs(d).toFixed(2)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2.5 font-mono text-[9px] leading-relaxed text-gray-600">
              Each print is the pyth settlement price at that bell — the number every ticket on the round
              resolved against.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
