'use client';

// /feed — the vertical tape: a full-screen snap feed of the 6-24 venue.
//
// One card per screen, swipe up for the next — the social-feed posture is the
// product's habit loop. Everything on every card is REAL: live (future-expiry)
// markets straight from the DeepBook Predict beta indexer, the settlement pyth
// spot, the UP line the ticket actually buys (spot − $20 cushion), and the
// oracle settlement prints. No fabricated engagement, no placeholder volume —
// if a number isn't real it isn't rendered. Betting happens on /markets (the
// founder-validated ticket drawer); every CTA here routes there.
//
// Deck stability: cards are APPEND-ONLY for the session. A live round that
// rings doesn't vanish (that would yank the scroll) — it transforms in place
// into its own settlement print the moment the oracle posts it, which is the
// feed's reveal beat. New rounds/prints join at the bottom.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

// deck caps — enough for a long session without unbounded growth
const MAX_LIVE_INITIAL = 5;
const MAX_PRINTS_INITIAL = 6;
const MAX_DECK = 24;

type DeckEntry = { kind: 'live'; market: Market624 } | { kind: 'print'; print: Print624 };

const entryKey = (e: DeckEntry) => (e.kind === 'live' ? `L:${e.market.id}` : `P:${e.print.marketId}`);

// ─── card shell — folio head row, kanji ghost, phone column on desktop ───

function CardShell({
  headLeft,
  folio,
  kanji,
  kanjiTop = 'top-[26%]',
  children,
}: {
  headLeft: ReactNode;
  folio: string;
  kanji: string;
  kanjiTop?: string; // chart-variant cards park the ghost behind the question type, off the tape
  children: ReactNode;
}) {
  return (
    <section className="feed-card relative">
      <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col overflow-hidden px-5 pb-[96px] pt-4 min-[721px]:border-x min-[721px]:border-white/[0.06] min-[721px]:px-6 min-[721px]:pb-7">
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-3 ${kanjiTop} select-none font-jp text-[172px] leading-none text-white/[0.03]`}
        >
          {kanji}
        </span>
        <div className="relative flex items-center justify-between gap-3">
          {headLeft}
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600">{folio}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

// ─── the print reveal — "THE BELL RANG", shared by print cards and rung rounds ───

function PrintBody({ print, delta }: { print: Print624; delta: number | null }) {
  const [int, cents] = print.priceUsd.toFixed(2).split('.');
  return (
    <div className="relative flex min-h-0 flex-1 flex-col justify-center">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-vermilion">
        <span className="h-1.5 w-1.5 rounded-full bg-vermilion" />
        the bell rang
      </div>
      <div className="mt-4 font-display text-[48px] font-extrabold leading-none tracking-tight text-white">
        <span className="tabular-nums">${Number(int).toLocaleString('en-US')}</span>
        <span className="text-[24px] font-bold text-gray-500">.{cents}</span>
      </div>
      <div className="mt-3 font-mono text-[13px] tabular-nums">
        {delta == null ? (
          <span className="text-gray-600">oldest print on this tape</span>
        ) : (
          <span className={delta >= 0 ? 'text-vermilion' : 'text-gray-500'}>
            {delta >= 0 ? '▲' : '▽'} ${Math.abs(delta).toFixed(2)}{' '}
            <span className="text-gray-600">vs the prior bell</span>
          </span>
        )}
      </div>
      <div className="mt-6 flex items-baseline gap-2.5 border-t border-white/[0.07] pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
        <span>bell {clockHM(print.expiry)}</span>
        <span className="text-gray-700">·</span>
        <span>{CAD_WORD[print.cadence]} round</span>
        <span className="ml-auto font-jp text-[12px] normal-case tracking-normal text-gray-600">決算</span>
      </div>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600">
        oracle-settled · the pyth print at the exact second
      </p>
    </div>
  );
}

function PrintCard({ print, delta, folio }: { print: Print624; delta: number | null; folio: string }) {
  return (
    <CardShell
      folio={folio}
      kanji="決"
      headLeft={
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gray-600">
          settlement print
        </span>
      }
    >
      <PrintBody print={print} delta={delta} />
      <Link
        href="/markets"
        className="relative mt-4 flex items-center justify-center gap-2 rounded-lg border border-white/10 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-300 transition-colors hover:border-white/25 hover:text-white"
        style={{ outline: 'none' }}
        data-cursor="hover"
      >
        catch the next bell <span aria-hidden>→</span>
      </Link>
    </CardShell>
  );
}

// ─── a live round — question, tape, countdown, one vermilion CTA ───

function RoundCard({
  market,
  spot,
  series,
  now,
  active,
  folio,
  variant,
  print,
  delta,
}: {
  market: Market624;
  spot: number | null;
  series: number[];
  now: number;
  active: boolean;
  folio: string;
  variant: 'chart' | 'number';
  print: Print624 | null;
  delta: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : null;
  const rung = now > 0 && market.expiry <= now;
  const closing = !rung && msLeft != null && msLeft <= minMintMs(market.cadence);
  // FREEZE the line per market: recomputing it from live spot every render made the
  // "±$N vs the line" stat a constant $20 dressed up as signal. Locked to the spot at
  // first sight of the market, the distance becomes a genuinely moving number.
  const frozen = useRef<{ id: string; line: number } | null>(null);
  if (spot != null && frozen.current?.id !== market.id) {
    frozen.current = { id: market.id, line: Math.round(spot - BAND_USD) };
  }
  const line = frozen.current?.id === market.id ? frozen.current.line : null;

  useEffect(() => {
    if (rung || !canvasRef.current || series.length < 2) return;
    const base = {
      target: line ?? undefined,
      targetLabel: line != null ? `up line · ${usd0(line)}` : undefined,
      color: '#E04D26',
      gridLines: true,
      axisRight: 54,
      padX: 10,
      padTop: 10,
      padBot: 10,
    };
    // Only the on-screen card runs the animated tape — off-screen cards draw
    // once, statically, so a 10-card deck doesn't run 10 rAF loops.
    if (!active) {
      drawPriceLine(canvasRef.current, series, base);
      return;
    }
    let raf = 0;
    const draw = (t: number) => {
      if (!canvasRef.current) return;
      drawPriceLine(canvasRef.current, series, { ...base, motion: true, now: t });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [series, line, active, rung]);

  const headLeft = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-full border border-vermilion/25 bg-vermilion/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion">
        <span className={`h-1 w-1 rounded-full bg-vermilion ${rung ? '' : 'animate-pulse'}`} />
        {CAD_WORD[market.cadence]} round
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600">
        bell {clockHM(market.expiry)}
      </span>
    </div>
  );

  // ── rung + settled → the reveal, in place ──
  if (rung && print) {
    return (
      <CardShell folio={folio} kanji="決" headLeft={headLeft}>
        <PrintBody print={print} delta={delta} />
        <Link
          href="/markets"
          className="relative mt-4 flex items-center justify-center gap-2 rounded-lg border border-white/10 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-300 transition-colors hover:border-white/25 hover:text-white"
          style={{ outline: 'none' }}
          data-cursor="hover"
        >
          catch the next bell <span aria-hidden>→</span>
        </Link>
      </CardShell>
    );
  }

  // ── rung, print not posted yet → honest interim beat ──
  if (rung) {
    return (
      <CardShell folio={folio} kanji="決" headLeft={headLeft}>
        <div className="relative flex flex-1 flex-col items-center justify-center text-center">
          <div className="font-jp text-[56px] leading-none text-gray-700">鐘</div>
          <div className="mt-5 font-mono text-[10px] uppercase tracking-[0.3em] text-vermilion">
            the bell rang
          </div>
          <div className="mt-2 font-display text-[26px] font-extrabold tracking-tight text-white">
            bell {clockHM(market.expiry)}
          </div>
          <p className="mt-3 animate-pulse font-mono text-[9px] uppercase tracking-[0.18em] text-gray-500">
            reading the settlement print…
          </p>
        </div>
      </CardShell>
    );
  }

  const countdown = (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-gray-600">to the bell</div>
      <div
        className={`mt-1 font-mono font-semibold leading-none tabular-nums ${
          closing ? 'text-vermilion' : 'text-white'
        } ${variant === 'number' ? 'text-[72px] tracking-tight' : 'text-[44px]'}`}
      >
        {msLeft != null ? fmtBell624(msLeft) : '—'}
      </div>
    </div>
  );

  const stats = (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
      <span>
        <span className="text-gray-600">SPOT </span>
        <span className="text-white">{spot != null ? usd2(spot) : '—'}</span>
      </span>
      {spot != null && line != null && (
        <span className={spot >= line ? 'text-vermilion' : 'text-gray-500'}>
          {spot >= line
            ? `+$${Math.round(spot - line)} above the line`
            : `−$${Math.round(line - spot)} below the line`}
        </span>
      )}
    </div>
  );

  return (
    <CardShell
      folio={folio}
      kanji="予"
      kanjiTop={variant === 'chart' ? 'top-[4%]' : 'top-[26%]'}
      headLeft={headLeft}
    >
      {/* the question — the UP ticket's real line right now */}
      <h2 className="relative mt-4 font-display text-[32px] font-extrabold leading-[1.08] tracking-tight text-white">
        {line != null ? (
          <>
            BTC above <span className="text-vermilion">{usd0(line)}</span> at the bell?
          </>
        ) : (
          <span className="text-gray-500">Reading the settlement feed…</span>
        )}
      </h2>

      {variant === 'chart' ? (
        <>
          {/* tape as the center mass */}
          <div className="relative mt-4 min-h-[150px] flex-1">
            <canvas ref={canvasRef} className="h-full w-full" />
          </div>
          <div className="relative mt-4 flex items-end justify-between gap-4">
            {countdown}
            <div className="pb-1 text-right">{stats}</div>
          </div>
        </>
      ) : (
        <>
          {/* countdown as the center mass */}
          <div className="relative flex min-h-0 flex-1 flex-col justify-center">
            {countdown}
            <div className="mt-4">{stats}</div>
          </div>
          <div className="relative h-[96px]">
            <canvas ref={canvasRef} className="h-full w-full" />
          </div>
        </>
      )}

      {closing ? (
        <div className="relative mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">
          closing — the next round is already rolling
        </div>
      ) : (
        <Link
          href="/markets"
          className="relative mt-4 flex items-center justify-center gap-2 rounded-lg bg-vermilion py-3.5 font-display text-[15px] font-bold text-white transition-colors hover:bg-vermilion-d"
          style={{ outline: 'none' }}
          data-cursor="hover"
        >
          Take a side <span aria-hidden>→</span>
        </Link>
      )}
      <p className="relative mt-2.5 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600">
        up · down · range on the ticket — oracle-settled, testnet funds
      </p>
    </CardShell>
  );
}

// ─── quiet Live Desk beat ───

function DeskCard({ folio }: { folio: string }) {
  return (
    <CardShell
      folio={folio}
      kanji="任"
      headLeft={
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gray-600">the live desk</span>
      }
    >
      <div className="relative flex flex-1 flex-col justify-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gray-500">
          while you scroll
        </div>
        <h2 className="mt-4 font-display text-[32px] font-extrabold leading-[1.1] tracking-tight text-white">
          The desk trades for its subscribers<span className="text-vermilion">.</span>
        </h2>
        <p className="mt-4 max-w-[320px] text-[13px] leading-relaxed text-gray-400">
          An attested agent takes its own tickets at these same bells — every trade signed on-chain,
          in the open.
        </p>
      </div>
      <Link
        href="/strategies"
        className="relative mt-4 flex items-center justify-center gap-2 rounded-lg border border-white/10 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-300 transition-colors hover:border-white/25 hover:text-white"
        style={{ outline: 'none' }}
        data-cursor="hover"
      >
        watch the desk <span aria-hidden>→</span>
      </Link>
    </CardShell>
  );
}

// ─── the loop card — the feed never ends, it rolls ───

function LoopCard({
  folio,
  nextBellIn,
  onTop,
}: {
  folio: string;
  nextBellIn: number | null;
  onTop: () => void;
}) {
  return (
    <CardShell
      folio={folio}
      kanji="回"
      headLeft={
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gray-600">the loop</span>
      }
    >
      <div className="relative flex flex-1 flex-col items-center justify-center text-center">
        <div className="font-jp text-[64px] leading-none text-gray-700">鐘</div>
        <h2 className="mt-5 font-display text-[30px] font-extrabold leading-tight tracking-tight text-white">
          Bells roll every minute<span className="text-vermilion">.</span>
        </h2>
        {nextBellIn != null && (
          <p className="mt-2.5 font-mono text-[12px] tabular-nums text-gray-400">
            next bell in <span className="text-vermilion">{fmtBell624(nextBellIn)}</span>
          </p>
        )}
        <button
          type="button"
          onClick={onTop}
          className="mt-7 rounded-lg border border-white/10 px-7 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-300 transition-colors hover:border-white/25 hover:text-white"
          style={{ outline: 'none' }}
          data-cursor="hover"
        >
          back to the top ↑
        </button>
      </div>
    </CardShell>
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
          setLoaded(true); // success only — a failed first read must not build a deck missing its live rounds
        }
      } catch (e) {
        if (!dead) setMarketsErr(String(e instanceof Error ? e.message : e).slice(0, 120));
      }
    };
    load();
    const iv = setInterval(load, 15_000);
    // indexer down → unblock the build anyway and degrade to the between-bells card
    const t = setTimeout(() => {
      if (!dead) setLoaded(true);
    }, 8_000);
    return () => {
      dead = true;
      clearInterval(iv);
      clearTimeout(t);
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

  // ~2.5 min of the settlement tape for the round charts (poll 15s)
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
  const [printsLoaded, setPrintsLoaded] = useState(false);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const p = await fetchRecentPrints624(8); // one extra so the oldest visible card still has a prior for its delta
        if (!dead && p.length) {
          setPrints(p);
          // real prints in hand only — an empty/failed first read must not build a
          // printless deck (late prints would append as a clump instead of interleaving)
          setPrintsLoaded(true);
        }
      } catch {
        /* keep last prints */
      }
    };
    load();
    const iv = setInterval(load, 20_000);
    // no prints after 8s (down indexer or a genuinely bare tape) → build without them
    const t = setTimeout(() => {
      if (!dead) setPrintsLoaded(true);
    }, 8_000);
    return () => {
      dead = true;
      clearInterval(iv);
      clearTimeout(t);
    };
  }, []);

  // print lookups — by market, and each print's delta vs the prior bell
  const printByMarket = useMemo(() => {
    const m = new Map<string, { print: Print624; delta: number | null }>();
    const sorted = [...prints].sort((a, b) => b.expiry - a.expiry); // newest first
    sorted.forEach((p, i) => {
      const prev = sorted[i + 1];
      m.set(p.marketId, { print: p, delta: prev ? p.priceUsd - prev.priceUsd : null });
    });
    return m;
  }, [prints]);

  // ── the deck — built once, then append-only (see file header) ──
  const [deck, setDeck] = useState<DeckEntry[]>([]);
  const builtRef = useRef(false);
  useEffect(() => {
    if (!loaded || !printsLoaded) return;
    const nowMs = Date.now();
    const liveNow = markets.filter((m) => m.expiry > nowMs);
    // The build/append branch lives OUTSIDE the setDeck updater: updaters are
    // double-invoked in dev (StrictMode), and mutating builtRef inside one made
    // the kept second invocation take the append path over an empty deck —
    // clumped, uncapped, never interleaved.
    if (!builtRef.current) {
      builtRef.current = true;
      const lv: DeckEntry[] = liveNow
        .slice(0, MAX_LIVE_INITIAL)
        .map((market) => ({ kind: 'live', market }));
      const pr: DeckEntry[] = prints
        .slice(0, MAX_PRINTS_INITIAL)
        .map((print) => ({ kind: 'print', print }));
      // live 1 + live 2 up top, then alternate print / round / print…
      const head = lv.slice(0, 2);
      const restLive = lv.slice(2);
      const tail: DeckEntry[] = [];
      const n = Math.max(restLive.length, pr.length);
      for (let i = 0; i < n; i++) {
        if (pr[i]) tail.push(pr[i]);
        if (restLive[i]) tail.push(restLive[i]);
      }
      setDeck([...head, ...tail]);
      return;
    }
    // appends only — removals/reorders would yank the reader's scroll
    setDeck((prev) => {
      const have = new Set(prev.map(entryKey));
      const add: DeckEntry[] = [];
      for (const market of liveNow) {
        const e: DeckEntry = { kind: 'live', market };
        if (!have.has(entryKey(e)) && !have.has(`P:${market.id}`)) add.push(e);
      }
      for (const print of prints) {
        const e: DeckEntry = { kind: 'print', print };
        if (!have.has(entryKey(e)) && !have.has(`L:${print.marketId}`)) add.push(e);
      }
      if (!add.length || prev.length >= MAX_DECK) return prev;
      return [...prev, ...add.slice(0, MAX_DECK - prev.length)];
    });
  }, [loaded, printsLoaded, markets, prints]);

  const ready = loaded && printsLoaded;
  const nextBellIn = useMemo(() => {
    if (now === 0) return null;
    const next = markets.map((m) => m.expiry).filter((e) => e > now).sort((a, b) => a - b)[0];
    return next != null ? next - now : null;
  }, [markets, now]);

  // ── snap container: current card index + swipe hint ──
  const feedRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [hintOn, setHintOn] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('yosuku:feed-hint')) {
        sessionStorage.setItem('yosuku:feed-hint', '1');
        setHintOn(true);
        const t = setTimeout(() => setHintOn(false), 6000);
        return () => clearTimeout(t);
      }
    } catch {
      /* sessionStorage unavailable — skip the hint */
    }
  }, []);
  const onScroll = () => {
    const el = feedRef.current;
    if (!el || el.clientHeight === 0) return;
    setIdx(Math.max(0, Math.round(el.scrollTop / el.clientHeight)));
    if (el.scrollTop > 30) setHintOn(false);
  };

  // total = deck + (desk card when the deck has substance) + the loop card
  const showDesk = deck.length >= 3;
  const total = ready ? deck.length + (showDesk ? 1 : 0) + 1 : 0;
  const folio = (i: number) => `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

  // if cards were appended above the reader (rare), hold their card steady
  const keys = useMemo(() => {
    const k = deck.map(entryKey);
    if (showDesk) k.push('desk');
    k.push('loop');
    return k;
  }, [deck, showDesk]);
  const prevKeysRef = useRef<string[]>([]);
  const idxRef = useRef(0);
  idxRef.current = idx;
  useLayoutEffect(() => {
    const el = feedRef.current;
    const prev = prevKeysRef.current;
    // Only meaningful once the deck exists — before the build, `keys` is just the
    // placeholder ['loop'], and "holding" that key would throw the reader to the
    // bottom of the freshly built deck.
    if (deck.length > 0 && el && prev.length && keys.length !== prev.length) {
      const curKey = prev[Math.min(idxRef.current, prev.length - 1)];
      const ni = keys.indexOf(curKey);
      if (ni >= 0 && ni !== idxRef.current) el.scrollTop = ni * el.clientHeight;
    }
    prevKeysRef.current = deck.length > 0 ? keys : [];
  }, [keys, deck.length]);

  let liveOrdinal = -1; // alternates round-card composition: chart-center / number-center

  return (
    <div className="relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* the tape — one card per screen */}
      <div
        ref={feedRef}
        onScroll={onScroll}
        className="feed-snap"
        style={{ outline: 'none' }}
        aria-label="Live market feed"
      >
        {!ready ? (
          <section className="feed-card relative">
            <div className="flex h-full flex-col items-center justify-center">
              <span className="font-jp text-4xl text-gray-700">帳</span>
              <p className="mt-4 animate-pulse font-mono text-[10px] uppercase tracking-[0.24em] text-gray-500">
                reading the tape…
              </p>
            </div>
          </section>
        ) : deck.length === 0 ? (
          <section className="feed-card relative">
            <div className="mx-auto flex h-full w-full max-w-[430px] flex-col items-center justify-center px-6 text-center min-[721px]:border-x min-[721px]:border-white/[0.06]">
              <div className="font-jp text-5xl text-gray-700">鐘</div>
              <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-white">
                Between bells<span className="text-vermilion">.</span>
              </h2>
              <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-gray-400">
                Markets roll every minute — the next round is moments away.
              </p>
              <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">
                {marketsErr ? 'feed unreachable · retrying every 15s' : 'refreshing automatically'}
              </p>
            </div>
          </section>
        ) : (
          <>
            {deck.map((e, i) => {
              if (e.kind === 'live') {
                liveOrdinal += 1;
                const hit = printByMarket.get(e.market.id) ?? null;
                return (
                  <RoundCard
                    key={entryKey(e)}
                    market={e.market}
                    spot={spot}
                    series={liveSeries}
                    now={now}
                    active={idx === i}
                    folio={folio(i)}
                    variant={liveOrdinal % 2 === 0 ? 'chart' : 'number'}
                    print={hit?.print ?? null}
                    delta={hit?.delta ?? null}
                  />
                );
              }
              const hit = printByMarket.get(e.print.marketId);
              return (
                <PrintCard
                  key={entryKey(e)}
                  print={e.print}
                  delta={hit?.delta ?? null}
                  folio={folio(i)}
                />
              );
            })}
            {showDesk && <DeskCard key="desk" folio={folio(deck.length)} />}
            <LoopCard
              key="loop"
              folio={folio(total - 1)}
              nextBellIn={nextBellIn}
              onTop={() => feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            />
          </>
        )}
      </div>

      {/* non-scrolling chrome: progress ticks, swipe hint, desktop vignette */}
      <div className="feed-chrome" aria-hidden>
        <div
          className="hidden min-[721px]:block absolute inset-0"
          style={{
            background: 'radial-gradient(62% 78% at 50% 46%, transparent 55%, rgba(0,0,0,0.55) 100%)',
          }}
        />
        {total > 1 && total <= 14 && (
          <div className="absolute right-[6px] top-1/2 flex -translate-y-1/2 flex-col items-center gap-[7px] min-[721px]:right-[calc(50%-233px)]">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={`w-[2px] rounded-full transition-all duration-300 ${
                  i === idx ? 'h-5 bg-vermilion' : 'h-2.5 bg-white/15'
                }`}
              />
            ))}
          </div>
        )}
        {/* one-time swipe hint — a coach-mark chip at 32% height: over the upper tape
            on a live card, above the centered type on reveal/interim cards — the one
            band that's graphics-or-empty on every composition; fades on first scroll */}
        <div
          className={`absolute left-1/2 top-[32%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-[#12100e]/90 px-5 py-2.5 text-gray-200 shadow-[0_8px_28px_rgba(0,0,0,0.55)] backdrop-blur-sm transition-opacity duration-700 ${
            hintOn && idx === 0 && ready && deck.length > 0 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.3em]">swipe</span>
          <span className="animate-bounce font-mono text-[13px] leading-none">↑</span>
        </div>
      </div>
    </div>
  );
}
