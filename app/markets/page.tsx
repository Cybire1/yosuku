'use client';

// /markets — THE FLAGSHIP market browser, re-powered by DeepBook Predict 6-24.
//
// The face is unchanged (cards, sparkline charts, cent odds, green/red UP/DOWN,
// the hero chart) — the ENGINE is the new venue: rolling cadence markets
// (1-minute / 5-minute / 1-hour; this deployment has NO 15-minute cadence, so we
// don't show one), REAL odds from house dry-run quotes (unsigned simulations —
// no keys), and a tap-to-bet TICKET DRAWER running the founder-validated
// /markets-live machinery (shared lib/sui/ticket624 — one implementation).
//
// The previous testnet's 15-minute rounds live under a collapsed "Previous venue"
// section at the bottom — routes to /markets/[id] keep working.

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useOracles } from '@/lib/sui/hooks';
import { type PriceData } from '@/lib/sui/predictApi';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { drawPriceLine } from '@/lib/charts/canvasChart';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import MarketCard from '@/components/MarketCard';
import MarketRoom from '@/components/MarketRoom';
import SectionHeader from '@/components/SectionHeader';
import TheBell from '@/components/TheBell';
import Tutorial from '@/components/Tutorial';
import Ticket624Drawer from '@/components/Ticket624Drawer';
import {
  fetchMarkets624,
  fetchSpot624,
  fetchPythHistory624,
  quoteMint624,
  type Cadence624,
  type Market624,
} from '@/lib/sui/predict624Client';
import { BAND_USD, minMintMs, strike624, ticks624, type Dir624 } from '@/lib/sui/ticket624';

// ─── house quoting (display odds) ───
// Dry-runs are UNSIGNED simulations against a funded house account — no keys are
// involved, and nothing is ever executed. The user's own bets quote with their
// own account in the ticket drawer.
const HOUSE_SENDER = '0x0099f97251af2d072fc492316ae30de3ab5639beb09073509d54bf49197513b4';
const HOUSE_WRAPPER = '0xc820ff1e36d8810f29d80ad81415fd064e02b7f20c41a4469e2f4400d514e706';
// 2 DUSDC payout @1× — the venue's smallest quotable ticket (min net premium is
// 1 DUSDC; a 1 DUSDC quote aborts). Cents shown = cost per $1 of payout.
const ODDS_QTY_MICRO = 2_000_000n;
const ODDS_STALE_MS = 18_000; // per-market cache — effective ~20s refresh
const ODDS_TICK_MS = 3_000; // sweep cadence (each sweep skips fresh markets)
const ODDS_STAGGER_MS = 350; // gap between per-market quote pairs

const CADENCE_WORD: Record<Cadence624, string> = { '1m': '1-minute', '5m': '5-minute', '1h': '1-hour' };
const CADENCES: Cadence624[] = ['1m', '5m', '1h'];

// One rail slot per cadence — a live market or a graceful "between rounds"
// placeholder — so the three categories are always present and never doubled.
type RailItem =
  | { kind: 'market'; market: Market624 }
  | { kind: 'placeholder'; cadence: Cadence624; nextMs: number | null };

function RailPlaceholder({ cadence }: { cadence: Cadence624 }) {
  return (
    <div className="market-card market-card-pending" aria-hidden="true">
      <div className="mc-head">
        <span className="mc-asset">
          <span className="glyph">₿</span>
          <span className="mc-ticker">BTC</span>
          <span className="mc-cadence">{CADENCE_WORD[cadence]}</span>
        </span>
        <span className="mc-countdown">
          <span className="clock-dot" />
          rolling
        </span>
      </div>
      {/* single text block — can't jam even if global CSS is stale */}
      <div className="mc-pending">
        <span className="mc-pending-dot" />
        <p className="mc-pending-copy">
          <strong>Between rounds.</strong> The next {CADENCE_WORD[cadence]} market is opening — this lane never closes.
        </p>
      </div>
    </div>
  );
}
const LIVE_HORIZON_LABELS = ['15-min', '30-min', '45-min', '1-hr'] as const; // previous venue only

const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'settling';
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

interface HouseOdds {
  upCents: number | null;
  downCents: number | null;
  /** The line the UP ticket will actually use (spot−$20 at quote time). */
  strikeUpUsd: number | null;
  /** The line the DOWN ticket will actually use (spot+$20 at quote time). */
  strikeDownUsd: number | null;
  at: number;
}

/**
 * REAL cent odds per market: house dry-run quote of a minimum ticket for each
 * band, normalised to cost per $1 of payout. Staggered + cached per market.
 * UP and DOWN are DIFFERENT bands (each with a $20 cushion) so they will not
 * sum to $1 — that is honest, not a bug.
 */
function useHouseOdds624(markets: Market624[], spot: number | null) {
  const [odds, setOdds] = useState<Record<string, HouseOdds>>({});
  const oddsRef = useRef(odds);
  oddsRef.current = odds;
  const marketsRef = useRef(markets);
  marketsRef.current = markets;
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const inflight = useRef(false);

  useEffect(() => {
    let dead = false;

    const quoteSide = async (marketId: string, dir: Dir624, spotNow: number): Promise<number | null> => {
      const { lowerTick, higherTick } = ticks624(spotNow, dir);
      const q = await quoteMint624({
        sender: HOUSE_SENDER,
        wrapperId: HOUSE_WRAPPER,
        marketId,
        lowerTick,
        higherTick,
        qtyMicro: ODDS_QTY_MICRO,
        leverage1e9: 1_000_000_000n,
      });
      if ('error' in q) return null;
      return Math.max(1, Math.min(99, Math.round((q.costMicro / Number(ODDS_QTY_MICRO)) * 100)));
    };

    const sweep = async () => {
      if (dead || inflight.current || spotRef.current == null) return;
      inflight.current = true;
      try {
        const nowMs = Date.now();
        const list = marketsRef.current.filter((m) => m.expiry - nowMs > minMintMs(m.cadence));
        for (const m of list) {
          if (dead) break;
          const cached = oddsRef.current[m.id];
          if (cached && Date.now() - cached.at < ODDS_STALE_MS) continue;
          const spotNow = spotRef.current;
          if (spotNow == null) break;
          const [up, down] = await Promise.all([quoteSide(m.id, 'up', spotNow), quoteSide(m.id, 'down', spotNow)]);
          if (dead) break;
          setOdds((o) => ({
            ...o,
            [m.id]: {
              upCents: up ?? o[m.id]?.upCents ?? null,
              downCents: down ?? o[m.id]?.downCents ?? null,
              strikeUpUsd: up != null ? strike624(spotNow, 'up') : o[m.id]?.strikeUpUsd ?? null,
              strikeDownUsd: down != null ? strike624(spotNow, 'down') : o[m.id]?.strikeDownUsd ?? null,
              at: Date.now(),
            },
          }));
          await new Promise((r) => setTimeout(r, ODDS_STAGGER_MS));
        }
      } finally {
        inflight.current = false;
      }
    };

    const t = setTimeout(() => void sweep(), 600); // fast first paint once data lands
    const iv = setInterval(() => void sweep(), ODDS_TICK_MS);
    return () => {
      dead = true;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  return odds;
}

// ─── the 6-24 market card — the flagship card face, new engine ───

function Spark624({ series, target }: { series: number[]; target: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (series.length >= 2) {
      drawPriceLine(ref.current, series, { target: target ?? undefined, targetLabel: '', verdict: true, padX: 4, padTop: 6, padBot: 6 });
    }
  }, [series, target]);
  return <canvas ref={ref} />;
}

function Market624Card({
  market,
  spot,
  series,
  deltaPct,
  odds,
  now,
  onOpen,
}: {
  market: Market624;
  spot: number | null;
  series: number[];
  deltaPct: number | null;
  odds: HouseOdds | undefined;
  now: number;
  onOpen: (market: Market624, side: Dir624 | null) => void;
}) {
  const [roomOpen, setRoomOpen] = useState(false);
  const msLeft = now > 0 ? market.expiry - now : null;
  const closing = msLeft != null && msLeft > 0 && msLeft <= minMintMs(market.cadence);
  const urgent = !closing && msLeft != null && msLeft < 5 * 60 * 1000;
  const strikeUp = odds?.strikeUpUsd ?? (spot != null ? spot - BAND_USD : null);
  const strikeDown = odds?.strikeDownUsd ?? (spot != null ? spot + BAND_USD : null);
  const question = strikeUp != null ? `BTC holds above ${fmtUsd0(strikeUp)}?` : 'BTC market';

  return (
    <>
    <article
      className={`market-card ${urgent ? 'urgent' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${question} Opens the bet ticket.`}
      onClick={() => onOpen(market, null)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(market, null);
        }
      }}
      data-cursor="hover"
    >
      <div className="mc-head">
        <span className="mc-asset">
          <span className="glyph">₿</span>
          <span className="mc-ticker">BTC</span>
          <span className="mc-cadence">{CADENCE_WORD[market.cadence]}</span>
        </span>
        <span className={`mc-countdown ${urgent || closing ? 'urgent' : ''}`}>
          <span className="clock-dot" />
          {msLeft != null ? fmtCountdown(msLeft) : '—'}
        </span>
      </div>

      <div className="mc-body">
        <div className="mc-question">
          {strikeUp != null ? (
            <>BTC holds above {fmtUsd0(strikeUp)}?</>
          ) : (
            <>BTC holds above <span className="strike-loading">···</span></>
          )}
          <span className="strike-dot" />
        </div>

        <div className="mc-pricebar">
          <div className="px">
            <span className="big">{spot != null ? fmtUsd0(spot) : '—'}</span>
            {deltaPct !== null && (
              <span className={`chg ${deltaPct >= 0 ? 'up' : 'down'}`}>
                {deltaPct >= 0 ? '+' : ''}
                {deltaPct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="mc-spark">
          <Spark624 series={series} target={strikeUp} />
        </div>

        {!closing ? (
          <div className="mc-strip">
            <span>{odds?.upCents != null ? 'LIVE · VENUE-QUOTED' : 'QUOTING THE VENUE…'}</span>
            <span className="ramp">
              <span>UP</span>
              <span className="bar">
                <span className="fill" style={{ width: `${Math.min(99, Math.max(1, odds?.upCents ?? 50))}%` }} />
              </span>
              <span className="pct">{odds?.upCents != null ? `${odds.upCents}¢` : '—'}</span>
            </span>
          </div>
        ) : (
          <div className="mc-strip">
            <span>CLOSING · NEXT ROUND SOON</span>
          </div>
        )}
      </div>

      {!closing && (
        <div className="mc-foot">
          <button
            type="button"
            className="mc-side up"
            data-cursor="up"
            aria-label={`Bet UP${odds?.upCents != null ? ` at ${odds.upCents} cents per dollar` : ''} — wins if BTC settles over ${strikeUp != null ? fmtUsd0(strikeUp) : 'the line'}`}
            title={strikeUp != null ? `wins if BTC settles over ${fmtUsd0(strikeUp)}` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(market, 'up');
            }}
          >
            <span>UP</span>
            <span className="price">{odds?.upCents != null ? `${odds.upCents}¢` : '···'}</span>
          </button>
          <button
            type="button"
            className="mc-side down"
            data-cursor="hover"
            aria-label={`Bet DOWN${odds?.downCents != null ? ` at ${odds.downCents} cents per dollar` : ''} — wins if BTC settles under ${strikeDown != null ? fmtUsd0(strikeDown) : 'the line'}`}
            title={strikeDown != null ? `wins if BTC settles under ${fmtUsd0(strikeDown)}` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(market, 'down');
            }}
          >
            <span>DOWN</span>
            <span className="price">{odds?.downCents != null ? `${odds.downCents}¢` : '···'}</span>
          </button>
        </div>
      )}

      <button
        type="button"
        className="mc-room"
        data-cursor="hover"
        aria-label="Open the room — bettors-only chat for this market"
        onClick={(e) => {
          e.stopPropagation();
          setRoomOpen(true);
        }}
      >
        <span className="mc-room-ico" aria-hidden>💬</span>
        <span className="mc-room-label">The Room</span>
        <span className="mc-room-hint">bettors only · encrypted</span>
      </button>
    </article>
    {roomOpen && (
      <MarketRoom
        marketId={market.id}
        callLabel={`${question} · ${CADENCE_WORD[market.cadence]}`}
        onClose={() => setRoomOpen(false)}
        onBet={() => {
          setRoomOpen(false);
          onOpen(market, null);
        }}
      />
    )}
    </>
  );
}

// ─── page ───

export default function MarketsPage() {
  // clock
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // 6-24 markets (poll 15s)
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [marketsErr, setMarketsErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const all = await fetchMarkets624();
        if (!dead) {
          setMarkets(all.filter((m) => m.minsOut < 65));
          setMarketsErr(null);
        }
      } catch (e) {
        if (!dead) setMarketsErr(String(e instanceof Error ? e.message : e).slice(0, 120));
      }
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, []);

  // live spot from the SETTLEMENT pyth feed (poll 5s)
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

  // one shared price series for the hero + every sparkline — all markets settle
  // on the SAME BTC pyth feed (~1 observation/sec, ≈2 min lookback)
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const h = await fetchPythHistory624(120);
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
  const deltaPct = useMemo(() => {
    if (liveSeries.length < 2) return null;
    const first = liveSeries[0];
    const last = liveSeries[liveSeries.length - 1];
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [liveSeries]);

  // The rail stays on the current round until its actual expiry. Trading pauses
  // only during the short submission buffer; the timer must never jump early to
  // the following round (especially visible on the 1-minute cadence).
  const railItems = useMemo<RailItem[]>(() => {
    const current: Partial<Record<Cadence624, Market624>> = {};
    for (const m of markets) { // markets is soonest-first
      if ((now === 0 || m.expiry > now) && !current[m.cadence]) current[m.cadence] = m;
    }
    return CADENCES.map((c) =>
      current[c]
        ? { kind: 'market', market: current[c]! }
        : { kind: 'placeholder', cadence: c, nextMs: null },
    );
  }, [markets, now]);
  const railMarkets = useMemo(
    () => railItems.flatMap((i) => (i.kind === 'market' ? [i.market] : [])),
    [railItems],
  );

  // The featured market a new user lands on — a FRESH 5-minute (smoothest to bet on: enough
  // runway to read the chart, and its odds move far less while you sign than a 1-minute).
  // Prefer 5m → 1h → and only fall back to the jumpy 1m if nothing else is open. Soonest-first
  // within a cadence so the chart has live context.
  const featuredMarket = useMemo(() => {
    const mintable = (m: Market624) => now === 0 || m.expiry - now > minMintMs(m.cadence);
    const soonest = (c: Cadence624) =>
      markets.filter((m) => m.cadence === c && mintable(m)).sort((a, b) => a.expiry - b.expiry)[0] ?? null;
    return soonest('5m') ?? soonest('1h') ?? soonest('1m') ?? markets.find(mintable) ?? null;
  }, [markets, now]);

  // ticket = the market you're actively sizing a bet on. Tapping a card sets it,
  // and the HERO renders this market (chart + bet controls together) — so a card
  // tap "loads into the hero", never a separate panel.
  const [ticket, setTicket] = useState<{
    market: Market624;
    side: Dir624 | null;
    sessionId: number;
  } | null>(null);
  const openTicket = (market: Market624, side: Dir624 | null) => {
    setTicket({ market, side, sessionId: Date.now() });
    // desktop: the bet lives in the hero at the top — bring it into view
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Keep the ticket tradable. If the selected round enters the submission buffer
  // while the user is sizing the bet, advance to the next market of the same
  // cadence. The bet keeps the current side, amount, and leverage.
  const ticketMarket = useMemo(() => {
    if (!ticket) return null;
    const selected = markets.find((m) => m.id === ticket.market.id) ?? ticket.market;
    if (now === 0 || selected.expiry - now > minMintMs(selected.cadence)) return selected;
    return markets.find(
      (m) => m.cadence === selected.cadence && m.expiry - now > minMintMs(m.cadence),
    ) ?? selected;
  }, [ticket, markets, now]);

  // The hero shows whichever market you're focused on: an explicit pick, else the featured one.
  const heroMarket = ticketMarket ?? featuredMarket;

  // REAL odds — house dry-run quotes, staggered, ~20s per-market refresh.
  const quoteMarkets = useMemo(() => {
    const byId = new Map(railMarkets.map((m) => [m.id, m]));
    if (heroMarket) byId.set(heroMarket.id, heroMarket);
    return Array.from(byId.values());
  }, [railMarkets, heroMarket]);
  const odds = useHouseOdds624(quoteMarkets, spot);

  const heroOdds = heroMarket ? odds[heroMarket.id] : undefined;
  const heroStrike = heroOdds?.strikeUpUsd ?? (spot != null ? spot - BAND_USD : null);
  const heroMsLeft = heroMarket && now > 0 ? heroMarket.expiry - now : null;

  // hero chart — the same living chart treatment as before, on the settlement feed
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!heroCanvasRef.current || liveSeries.length < 2) return;
    // Hide the strike pill on phones — it crowds the narrow chart and the strike
    // is already in the headline. Re-evaluated ~1/s as liveSeries updates.
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 768;
    let raf = 0;
    const drawFrame = (t: number) => {
      if (!heroCanvasRef.current) return;
      drawPriceLine(heroCanvasRef.current, liveSeries, {
        target: heroStrike ?? undefined,
        targetLabel: heroStrike != null && !narrow ? `UP line · $${Math.round(heroStrike).toLocaleString()}` : '',
        verdict: true,
        gridLines: true,
        axisRight: 60,
        padX: 14,
        padTop: 12,
        padBot: 12,
        motion: true,
        now: t,
      });
      raf = window.requestAnimationFrame(drawFrame);
    };
    raf = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(raf);
  }, [liveSeries, heroStrike]);

  // fade the scroll cue once scrolling starts
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // previous venue (collapsed by default — mounts its hooks only when opened)
  const [prevOpen, setPrevOpen] = useState(false);

  const nextExpiry = markets[0]?.expiry;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Page Hero */}
      <section className="page-hero markets-hero">
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />

        <div className="container">
          <div className="breadcrumb">
            <a href="/" data-cursor="hover">Home</a>
            <span className="sep">/</span>
            <span style={{ color: 'var(--white)' }}>Markets</span>
          </div>

          <div className="hero-grid hero-grid-mini lg:![grid-template-columns:minmax(0,1fr)_400px] lg:!items-start">
            {/* Hero chart — the soonest live market */}
            <div className="hero-chart">
              <div className="hero-chart-head">
                <div>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-sans text-[17px] font-extrabold leading-none" style={{ background: '#F7931A', color: '#fff' }}>₿</span>
                    <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-white">
                      BTC{heroMarket ? ` · ${CADENCE_WORD[heroMarket.cadence]}` : ''}
                    </span>
                  </div>
                  <h2 className="font-display font-[800] text-[1.6rem] sm:text-4xl text-white tracking-tight leading-[1.05]">
                    {heroStrike != null ? (
                      <>BTC holds above <span className="text-vermilion">{fmtUsd0(heroStrike)}</span>?</>
                    ) : (
                      'BTC · USD'
                    )}
                  </h2>
                  {heroStrike != null && spot != null && (
                    <div className="flex items-center gap-2 mt-2.5 font-mono text-sm sm:text-base">
                      <span className={spot >= heroStrike ? 'text-profit font-semibold' : 'text-loss font-semibold'}>
                        {spot >= heroStrike
                          ? `$${Math.round(spot - heroStrike).toLocaleString()} above the UP line`
                          : `needs +$${Math.round(heroStrike - spot).toLocaleString()} for UP to win`}
                      </span>
                      {heroMsLeft != null && (
                        <>
                          <span className="text-gray-600">·</span>
                          <span className="text-gray-400">{fmtCountdown(heroMsLeft)} left</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {heroMarket && (
                  <div className="text-right shrink-0">
                    <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">Settles in</span>
                    <span className="font-mono text-2xl sm:text-3xl font-semibold text-white tabular-nums">
                      {heroMsLeft != null ? fmtCountdown(heroMsLeft) : '—'}
                    </span>
                  </div>
                )}
              </div>
              <div className="hero-chart-canvas">
                <canvas ref={heroCanvasRef} />
              </div>
              <div className="hero-chart-foot">
                <span>ORACLE-SETTLED · EACH SIDE PRICED FOR ITS OWN BAND</span>
                <span className="ramp">
                  <span>UP</span>
                  <span className="bar">
                    <span className="fill" style={{ width: heroOdds?.upCents != null ? `${heroOdds.upCents}%` : '50%' }} />
                  </span>
                  <span style={{ color: 'var(--vermilion)' }}>{heroOdds?.upCents != null ? `${heroOdds.upCents}¢` : '—'}</span>
                </span>
              </div>
              {heroMarket && (
                <div className="hero-yesno">
                  <button
                    type="button"
                    className="hyn hyn-yes"
                    aria-label="Bet UP"
                    onClick={() => openTicket(heroMarket, 'up')}
                    data-cursor="hover"
                  >
                    <span className="hyn-label">UP</span>
                    <span className="hyn-price">{heroOdds?.upCents != null ? `${heroOdds.upCents}¢` : '—'}</span>
                  </button>
                  <button
                    type="button"
                    className="hyn hyn-no"
                    aria-label="Bet DOWN"
                    onClick={() => openTicket(heroMarket, 'down')}
                    data-cursor="hover"
                  >
                    <span className="hyn-label">DOWN</span>
                    <span className="hyn-price">{heroOdds?.downCents != null ? `${heroOdds.downCents}¢` : '—'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* the bet — contained beside the hero chart (desktop); a slide-in drawer on mobile */}
            <Ticket624Drawer
              market={heroMarket}
              side={ticket?.side ?? null}
              sessionId={ticket?.sessionId ?? null}
              spot={spot}
              series={liveSeries}
              mobileOpen={!!ticket}
              onClose={() => setTicket(null)}
            />
          </div>
        </div>
        <button
          type="button"
          className={`scroll-cue${scrolled ? ' gone' : ''}`}
          aria-label="Scroll to markets"
          onClick={() => window.scrollTo({ top: window.innerHeight * 0.78, behavior: 'smooth' })}
        >
          <span className="scroll-cue-label">Markets below</span>
          <span className="scroll-cue-track"><span className="scroll-cue-dot" /></span>
        </button>
      </section>

      {/* Main content */}
      <main>
        <div className="container">
          {/* Loading / error */}
          {markets.length === 0 && !marketsErr && (
            <div className="empty-state">
              <div className="jp">予</div>
              <h3>Reading live markets…</h3>
              <p>Fetching cadence markets from DeepBook Predict</p>
            </div>
          )}
          {markets.length === 0 && marketsErr && (
            <div className="empty-state">
              <div className="jp">誤</div>
              <h3>Connection error</h3>
              <p>Couldn&apos;t reach the market feed — retrying every 15s.</p>
            </div>
          )}

          {/* Live now — one card per cadence (1m · 5m · 1h), always present */}
          {markets.length > 0 && (
            <section className="markets-section" data-section="live">
              <SectionHeader
                number="01"
                title="Live now"
                cadences={['1 min', '5 min', '1 hr']}
              />
              <div className="markets-grid markets-grid-live">
                {railItems.map((item) =>
                  item.kind === 'market' ? (
                    <Market624Card
                      key={item.market.id}
                      market={item.market}
                      spot={spot}
                      series={liveSeries}
                      deltaPct={deltaPct}
                      odds={odds[item.market.id]}
                      now={now}
                      onOpen={openTicket}
                    />
                  ) : (
                    <RailPlaceholder key={`ph-${item.cadence}`} cadence={item.cadence} />
                  ),
                )}
              </div>
            </section>
          )}

          {/* Previous venue — the old 15-minute rounds, collapsed */}
          <section className="markets-section" data-section="previous" id="previous-venue" style={{ paddingBottom: prevOpen ? 0 : 24 }}>
            <SectionHeader
              number="02"
              title="Previous venue"
              desc="The 15-minute rounds on the previous DeepBook Predict testnet — kept for receipts and old positions. New bets belong above."
              meta={prevOpen ? 'shown' : 'collapsed'}
            />
            <button
              type="button"
              className="w-full border border-white/[0.08] bg-white/[0.015] hover:bg-white/[0.03] transition-colors px-5 py-3.5 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 hover:text-white"
              onClick={() => setPrevOpen((v) => !v)}
              aria-expanded={prevOpen}
              data-cursor="hover"
            >
              <span>{prevOpen ? 'Hide the previous venue' : 'Show the previous venue'}</span>
              <span>{prevOpen ? '↑' : '↓'}</span>
            </button>
            {prevOpen && <PreviousVenue />}
          </section>
        </div>
      </main>

      {/* Footer */}
      <Footer />

      {/* The Bell — rings at the next 6-24 settle */}
      {nextExpiry && <TheBell targetTime={nextExpiry} />}

      {/* First-visit tutorial */}
      <Tutorial />
    </div>
  );
}

// ─── previous venue (old 15-min rounds) — mounts only when expanded ───

function BellChips({ rows }: { rows: ReadonlyArray<readonly [string, { oracle_id: string; expiry: number }[]]> }) {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="later-bells">
      {rows.map(([asset, list]) => (
        <div key={asset} className="later-bells-row">
          <span className="later-bells-asset">{asset}</span>
          <div className="later-bells-chips">
            {list.slice(0, 8).map((o) => (
              <Link key={o.oracle_id} href={`/markets/${o.oracle_id}`} className="bell-chip" data-cursor="hover">
                {fmtCountdown(o.expiry - nowMs)}
              </Link>
            ))}
            {list.length > 8 && <span className="bell-chip more">+{list.length - 8}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviousVenue() {
  const { active, settled, loading, error } = useOracles();
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const { price: btcPrice } = useBtcPrice();
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPrices() {
      try {
        const res = await fetch('/api/oracles?prices=1');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.prices) setPrices(data.prices as Record<string, PriceData>);
      } catch {
        /* ignore */
      }
    }
    loadPrices();
    const interval = setInterval(loadPrices, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const liveLadder = [...active]
    .filter((o) => o.expiry > nowMs)
    .sort((a, b) => a.expiry - b.expiry)
    .slice(0, LIVE_HORIZON_LABELS.length)
    .map((oracle, index) => ({ oracle, horizonLabel: LIVE_HORIZON_LABELS[index] ?? `${(index + 1) * 15}-min` }));
  const ladderIds = new Set(liveLadder.map(({ oracle }) => oracle.oracle_id));
  const byAsset = new Map<string, typeof active>();
  for (const o of active) {
    if (o.expiry <= nowMs || ladderIds.has(o.oracle_id)) continue;
    const a = o.underlying_asset || 'BTC';
    if (!byAsset.has(a)) byAsset.set(a, []);
    byAsset.get(a)!.push(o);
  }
  for (const list of byAsset.values()) list.sort((a, b) => a.expiry - b.expiry);
  const laterBells = Array.from(byAsset.entries()).filter(([, list]) => list.length > 0);
  const recentSettled = settled.slice(0, 6);

  return (
    <div className="pt-8 space-y-12">
      {loading && (
        <div className="empty-state">
          <div className="jp">予</div>
          <h3>Loading previous venue…</h3>
          <p>Fetching oracles from the old DeepBook Predict testnet</p>
        </div>
      )}
      {error && !loading && (
        <div className="empty-state">
          <div className="jp">誤</div>
          <h3>Previous venue unreachable</h3>
          <p>{error}</p>
        </div>
      )}
      {!loading && !error && active.length === 0 && recentSettled.length === 0 && (
        <div className="empty-state">
          <div className="jp">空</div>
          <h3>No rounds on the previous venue</h3>
          <p>The old testnet may have wound down — new markets live above.</p>
        </div>
      )}

      {liveLadder.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
            Still running · 15 / 30 / 45 / 60 min rounds
          </div>
          <div className="markets-grid markets-grid-live">
            {liveLadder.map(({ oracle, horizonLabel }) => {
              const price = prices[oracle.oracle_id];
              const referencePrice = price?.forward || price?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
              const line = getCanonicalMarketLine({ oracle, settledOracles: settled, referencePrice });
              return (
                <MarketCard
                  key={oracle.oracle_id}
                  oracle={oracle}
                  spotPrice={price?.spot}
                  forwardPrice={price?.forward}
                  seedStrike={line?.source === 'grid-fallback' ? null : line?.strike}
                  horizonLabel={horizonLabel}
                />
              );
            })}
          </div>
        </div>
      )}

      {laterBells.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
            Upcoming rounds · tap a time to open it
          </div>
          <BellChips rows={laterBells} />
        </div>
      )}

      {recentSettled.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
            Recently settled · receipts on Suiscan, payouts in DUSDC
          </div>
          <div className="markets-grid">
            {recentSettled.map((oracle) => (
              <MarketCard key={oracle.oracle_id} oracle={oracle} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
