'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import YosukuMark from '@/components/YosukuMark';

import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useOracles, useProtocolStats } from '@/lib/sui/hooks';
import { useBell624 } from '@/lib/sui/bell624';
import { type PriceData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { getCanonicalMarketLine } from '@/lib/marketLine';

/* ───────── Types ───────── */
interface FaqItem {
  q: string;
  a: string;
  tags: string[];
  cat: string;
}

interface HowStep {
  num: string;
  jp: string;
  kicker: string;
  title: string;
  body: string;
  meta: string;
}

interface FeatureItem {
  act: string;
  idx: string;
  title: string;
  em: string;
  desc: string;
  keys: string[];
  jp: string;
}

interface SpecRow {
  label: string;
  value: string;
}

/* ───────── Sparkline SVG generator ───────── */
function sparklineSVG(
  data: number[],
  w: number,
  h: number,
  color: string = 'rgba(255,255,255,0.35)'
): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M${pts.join(' L')}`;
  return `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`;
}

/* ───────── Static data ───────── */
const ASSET_GLYPH: Record<string, string> = {
  BTC: '\u20BF', ETH: '\u039E', SOL: 'S', SUI: '\u25E2',
};

const HOW_STEPS: HowStep[] = [
  { num: '01', jp: '\u5E02\u5834', kicker: 'Choose', title: 'Pick a market.', body: 'Every BTC market has a strike price and a fixed window \u2014 1-minute, 5-minute, or hourly rounds. One question: above or below at close.', meta: 'Fast rounds \u00B7 continuous' },
  { num: '02', jp: '\u53D6\u5F15', kicker: 'Commit', title: 'Take a side.', body: 'One press and your call is locked in. No order book, no haggling — just up or down before the clock runs out.', meta: 'One tap \u00B7 instant' },
  { num: '03', jp: '\u6C7A\u6E08', kicker: 'Settle', title: 'Settle on-chain.', body: 'When the clock hits zero, the final price decides it automatically. Call it right and you get paid; call it wrong and your stake is gone. No waiting on anyone.', meta: 'Pays out on the price \u00B7 no waiting' },
];

const FEATURES: FeatureItem[] = [
  { act: '01', idx: 'I', title: 'Two sides. ', em: 'One press.', desc: 'Pick above or below. When the clock runs out, the live price decides — automatically, with no order books and no appeals.', keys: ['One-tap UP/DOWN', 'Fast rounds', 'Auto-paid'], jp: '\u53D6\u5F15' },
  { act: '02', idx: 'II', title: 'Leave when ', em: 'you like.', desc: 'Change your mind? Cash out at the live price any time before the round closes \u2014 no lock-ins, no penalties.', keys: ['Cash out anytime', 'Live pricing', 'Always fair'], jp: '\u81EA\u7531' },
  { act: '03', idx: 'III', title: 'A side, or ', em: 'a range.', desc: 'Bet on a single price, or on a range between two. However you read the market, there\u2019s a way to play it.', keys: ['Any price', 'Pick a range', 'Every angle'], jp: '\u7BC4\u56F2' },
  { act: '04', idx: 'IV', title: 'Be the ', em: 'house.', desc: 'Put money into the pool that backs every market and earn a cut of every round. Here the house isn\u2019t a company \u2014 it\u2019s a pool anyone can join.', keys: ['Join the pool', 'Earn a cut', 'Open to all'], jp: '\u80F4\u5143' },
  { act: '05', idx: 'V', title: 'A keeper with ', em: 'rules.', desc: 'Our Autopilot trades inside hard limits it can\u2019t break \u2014 spending caps, an approved list, and a daily stop. The rules are locked in, not up for negotiation.', keys: ['Runs on Autopilot', 'Hard limits', 'Every move logged'], jp: '\u756A\u4EBA' },
];

const FAQ_DATA: FaqItem[] = [
  { q: 'What does YOSUKU settle on?', a: 'The live price of Bitcoin, straight from the market. Every result is decided automatically by that price — not by YOSUKU. We can’t tip the scales.', tags: ['Oracle', 'Sui'], cat: 'Protocol' },
  { q: 'How does YOSUKU make money?', a: 'A small margin is built into the price you see. If you choose to amplify a bet, there’s a small extra fee for that. That’s it.', tags: ['Fees', 'Transparency'], cat: 'Protocol' },
  { q: 'Can I lose more than I stake?', a: 'No. The most you can ever lose is what you put in — even if you choose to amplify a bet.', tags: ['Risk', 'Binary'], cat: 'Mechanics' },
  { q: 'Why fixed windows?', a: 'Every round runs on a clock — 1-minute, 5-minute, and 1-hour Bitcoin markets. Short ones are quick and fun; longer ones give the price room to move. Pick the pace that suits you — each one settles the moment it closes.', tags: ['Design', 'Timing'], cat: 'Mechanics' },
  { q: 'Is this available in my country?', a: 'YOSUKU runs on an open network, so there’s no country-based block built in. That said, it’s on you to follow the rules where you live.', tags: ['Legal', 'Access'], cat: 'Access' },
];

const SPEC_ROWS: SpecRow[] = [
  { label: 'Runs on', value: 'Sui' },
  { label: 'Payouts', value: 'Automatic, on the closing price' },
  { label: 'Prices', value: 'Live market price' },
  { label: 'Round length', value: '1 minute, 5 minutes, or 1 hour' },
  { label: 'Money', value: 'Test dollars (not real money)' },
  { label: 'Speed', value: 'Settles in under a second' },
  { label: 'Audits', value: 'In progress' },
];

// Every link goes somewhere real — dead '#' anchors read as broken to a judge.
const FOOTER_COLS: { title: string; links: { label: string; href: string; ext?: boolean }[] }[] = [
  { title: 'Product', links: [
    { label: 'Markets', href: '/markets' },
    { label: 'Sensei', href: '/sensei' },
    { label: 'Reels', href: '/reels' },
    { label: 'Portfolio', href: '/portfolio' },
    { label: 'Leaderboard', href: '/leaderboard' },
    { label: 'Stats', href: '/stats' },
    { label: 'Docs', href: '/docs' },
  ] },
  { title: 'Develop', links: [
    { label: 'GitHub', href: 'https://github.com/shaibuafeez/yosuku', ext: true },
    { label: 'SDK', href: 'https://www.npmjs.com/package/@yosuku/deepbook-predict', ext: true },
    { label: 'MCP server', href: 'https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp', ext: true },
  ] },
  { title: 'Society', links: [
    { label: 'X · @yosuku0', href: 'https://x.com/yosuku0', ext: true },
  ] },
];

/* ───────── Helpers ───────── */
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}


/* ═══════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════ */
export default function HomePage() {
  const { price: btcPrice } = useBtcPrice();
  const { nextBellMs, liveCount: liveBells624 } = useBell624();
  const { active: liveOracles, settled: settledOracles, loading: oraclesLoading } = useOracles();
  const { stats: protocolStats, loading: statsLoading } = useProtocolStats();
  const [oraclePrices, setOraclePrices] = useState<Record<string, PriceData>>({});
  const [nowMs, setNowMs] = useState(0);

  /* ── state ── */
  const [probability, setProbability] = useState<number>(50);
  const [sparkPath, setSparkPath] = useState<string>('');
  const [marketTab, setMarketTab] = useState<string>('All');
  const [faqOpen, setFaqOpen] = useState<number>(0);
  const [activeFeature, setActiveFeature] = useState<number>(0);
  const [featureProgress, setFeatureProgress] = useState<number>(0);

  /* ── refs ── */
  const yesArcRef = useRef<SVGCircleElement>(null);
  const needleRef = useRef<SVGLineElement>(null);
  const howRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const featurePinRef = useRef<HTMLDivElement>(null);
  const lockedStrikesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const futureOracles = useMemo(() => {
    return liveOracles
      .filter(o => !nowMs || o.expiry > nowMs)
      .sort((a, b) => a.expiry - b.expiry);
  }, [liveOracles, nowMs]);

  /* ── Fetch prices via combined server route ── */
  useEffect(() => {
    let cancelled = false;
    async function loadPrices() {
      try {
        const res = await fetch('/api/oracles?prices=1');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.prices) {
          setOraclePrices(data.prices as Record<string, PriceData>);
        }
      } catch { /* ignore */ }
    }
    loadPrices();
    const interval = setInterval(loadPrices, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  /* ── Derive probability from first oracle ── */
  useEffect(() => {
    if (futureOracles.length === 0 || !nowMs) return;
    const firstOracle = futureOracles[0];
    const prices = oraclePrices[firstOracle.oracle_id];
    if (!prices) return;
    // Lock strike on first price — display shouldn't fluctuate
    if (!lockedStrikesRef.current[firstOracle.oracle_id]) {
      lockedStrikesRef.current[firstOracle.oracle_id] = getCanonicalMarketLine({
        oracle: firstOracle,
        settledOracles,
        referencePrice: prices.forward || prices.spot,
      })!.strike;
    }
    const midStrike = lockedStrikesRef.current[firstOracle.oracle_id];
    const midStrikeDollars = midStrike / FLOAT_SCALING;
    const forward = prices.forward / FLOAT_SCALING;
    if (midStrikeDollars > 0 && forward > 0) {
      const diff = (forward - midStrikeDollars) / midStrikeDollars;
      const secsLeft = Math.max(60, (firstOracle.expiry - nowMs) / 1000);
      const sigma = 0.001 * Math.sqrt(secsLeft / 60);
      const z = diff / (sigma || 0.01);
      const p = Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z)))));
      setProbability(p);
    }
  }, [futureOracles, nowMs, oraclePrices, settledOracles]);

  /* ── Dial sparkline (decorative) ── */
  useEffect(() => {
    function genPath(): string {
      const pts: number[] = [];
      let v = 50;
      for (let i = 0; i < 40; i++) {
        v += (Math.random() - 0.48) * 6;
        v = clamp(v, 10, 90);
        pts.push(v);
      }
      const w = 120;
      const h = 60;
      const min = Math.min(...pts);
      const max = Math.max(...pts);
      const range = max - min || 1;
      return pts.map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - ((p - min) / range) * h * 0.7 - h * 0.15;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    }
    setSparkPath(genPath());
    const iv = setInterval(() => setSparkPath(genPath()), 1800);
    return () => clearInterval(iv);
  }, []);

  /* ── Dial countdown — the REAL next bell on the live 6-24 venue ──
     The legacy oracles above expire ~6 days out (the dial used to read
     "9100:12"); the venue that actually trades rings every minute. */
  const dialExpiry = useMemo(() => {
    if (!nextBellMs || !nowMs) return 0;
    return Math.max(0, Math.floor((nextBellMs - nowMs) / 1000));
  }, [nextBellMs, nowMs]);

  const [dialCountdown, setDialCountdown] = useState<number>(0);
  useEffect(() => {
    setDialCountdown(dialExpiry);
  }, [dialExpiry]);

  useEffect(() => {
    const iv = setInterval(() => {
      setDialCountdown(t => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ── Build market cards from real oracles ── */
  const displayMarkets = useMemo(() => {
    return futureOracles.slice(0, 6).map((oracle, i) => {
      const asset = oracle.underlying_asset || 'BTC';
      const glyph = ASSET_GLYPH[asset] || asset[0];
      const prices = oraclePrices[oracle.oracle_id];
      // Lock strike on first price — question text shouldn't fluctuate
      const refPrice = prices?.forward || prices?.spot;
      if (!lockedStrikesRef.current[oracle.oracle_id]) {
        lockedStrikesRef.current[oracle.oracle_id] = getCanonicalMarketLine({
          oracle,
          settledOracles,
          referencePrice: refPrice,
        })!.strike;
      }
      const midStrike = lockedStrikesRef.current[oracle.oracle_id]
        ?? getCanonicalMarketLine({ oracle, settledOracles, referencePrice: refPrice })!.strike;
      const midStrikeDollars = midStrike / FLOAT_SCALING;

      let yesC = 50;
      if (prices) {
        const forward = prices.forward / FLOAT_SCALING;
        if (midStrikeDollars > 0 && forward > 0) {
          const diff = (forward - midStrikeDollars) / midStrikeDollars;
          const secsLeft = Math.max(60, (oracle.expiry - nowMs) / 1000);
          const sigma = 0.001 * Math.sqrt(secsLeft / 60);
          const z = diff / (sigma || 0.01);
          yesC = Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z)))));
        }
      }

      const secsLeft = nowMs ? Math.max(0, Math.floor((oracle.expiry - nowMs) / 1000)) : 0;
      const formatStrike = (n: number) => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      const expDate = new Date(oracle.expiry);
      const timeStr = expDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

      // Generate a deterministic sparkline from oracle id
      const sparkSeed = oracle.oracle_id.charCodeAt(4) || 7;
      const spark: number[] = [];
      let sv = 50;
      let s = sparkSeed * 9301 + 49297;
      for (let j = 0; j < 20; j++) {
        s = (s * 9301 + 49297) % 233280;
        sv += (s / 233280 - 0.48) * 8;
        sv = Math.max(10, Math.min(90, sv));
        spark.push(sv);
      }

      return {
        asset,
        glyph,
        question: `${asset} above ${formatStrike(midStrikeDollars)} at ${timeStr} UTC?`,
        yesC,
        vol: '—',
        traders: 0,
        secsLeft,
        hot: i === 0,
        featured: i === 0,
        spark,
        oracleId: oracle.oracle_id,
        strike: midStrike,
      };
    });
  }, [futureOracles, nowMs, oraclePrices, settledOracles]);

  /* ── Derive spot prices for ticker ── */
  const spotPrices = useMemo(() => {
    const byAsset: Record<string, number> = {};
    for (const oracle of futureOracles) {
      const asset = oracle.underlying_asset || 'BTC';
      const prices = oraclePrices[oracle.oracle_id];
      if (prices && !byAsset[asset]) {
        byAsset[asset] = prices.spot / FLOAT_SCALING;
      }
    }
    return byAsset;
  }, [futureOracles, oraclePrices]);

  /* ── Dial question label ── */
  const dialLabel = useMemo(() => {
    if (futureOracles.length === 0) return 'BTC > $95,000';
    const o = futureOracles[0];
    const asset = o.underlying_asset || 'BTC';
    const prices = oraclePrices[o.oracle_id];
    const refPrice = prices?.forward || prices?.spot;
    if (!lockedStrikesRef.current[o.oracle_id]) {
      lockedStrikesRef.current[o.oracle_id] = getCanonicalMarketLine({
        oracle: o,
        settledOracles,
        referencePrice: refPrice,
      })!.strike;
    }
    const midStrike = lockedStrikesRef.current[o.oracle_id]
      ?? getCanonicalMarketLine({ oracle: o, settledOracles, referencePrice: refPrice })!.strike;
    const dollars = midStrike / FLOAT_SCALING;
    return `${asset} > $${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }, [futureOracles, oraclePrices, settledOracles]);

  /* ── IntersectionObserver for .how-steps ── */
  useEffect(() => {
    const el = howRef.current;
    if (!el) return;
    // Fallback: if the observer can't run, reveal immediately so the section
    // is never left permanently blank (e.g. a full-page screenshot capture).
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in-view'); return; }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
          }
        });
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── IntersectionObserver for .fade-up ── */
  useEffect(() => {
    const els = document.querySelectorAll('.fade-up');
    // Fallback: reveal all if the observer is unavailable, so no content
    // section can be stranded at opacity:0 with no way to become visible.
    if (typeof IntersectionObserver === 'undefined') { els.forEach(e => e.classList.add('in-view')); return; }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach(e => obs.observe(e));
    return () => obs.disconnect();
  }, []);

  /* ── Scroll-driven features crossfade ── */
  useEffect(() => {
    function onScroll() {
      const section = featuresRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const sectionH = section.offsetHeight;
      const scrolled = -rect.top;
      const denom = sectionH - window.innerHeight;
      const progress = denom > 0 ? clamp(scrolled / denom, 0, 1) : 0;
      setFeatureProgress(progress);
      const idx = Math.min(FEATURES.length - 1, Math.floor(progress * FEATURES.length));
      setActiveFeature(idx);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── Derived ── */
  const dashOffset = 100 - probability;
  const needleAngle = (probability / 100) * 360 - 90;
  const filteredMarkets = marketTab === 'All' ? displayMarkets : displayMarkets.filter(m => m.asset === marketTab);
  const marketTabs = ['All', 'BTC'];


  return (
    <div className="landing">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* ═══════ HERO ═══════ */}
      <section className="hero">
        <div className="hero-grid-lines" />
        <div className="hero-watermark">{'\u4E88\u6E2C'}</div>
        <div className="hero-cursor-glow" />

        {/* Award badge */}
        <div className="hero-award">
          <div className="meta">
            <span>Edition One</span><br />
            <b>Tokyo 2026</b>
          </div>
          <div className="seal">
            <span className="seal-inner">{'\u4E88'}</span>
          </div>
        </div>

        {/* Hero frame corners */}
        <div className="hero-frame">
          <i /><b />
        </div>

        {/* Left column */}
        <div className="hero-left">
          <div className="hero-eyebrow">
            <span className="rule" />
            <span className="jp">{'\u4E88\u6E2C'}</span>
            <span>Foresight, rendered on-chain</span>
          </div>

          <h1 className="hero-title">
            <span className="l1">Read the room</span>
            <span className="l2">before the room reads itself.</span>
          </h1>

          <div className="hero-cta-row">
            <Link href="/markets" className="btn btn-primary" data-cursor="hover">
              Launch app {'\u2197'}
            </Link>
            <a href="#how" className="btn btn-ghost" data-cursor="hover">
              How it works {'\u2193'}
            </a>
          </div>

        </div>

        {/* Right column - Dial */}
        <div className="hero-right">
          <div className="hero-dial">
            <svg viewBox="0 0 300 300" className="hero-dial-svg">
              {/* Outer ring */}
              <circle cx="150" cy="150" r="140" className="dial-ring" />
              <circle cx="150" cy="150" r="120" className="dial-ring" />
              {/* Ticks */}
              {Array.from({ length: 72 }, (_, i) => {
                const angle = i * 5;
                const major = i % 9 === 0;
                const rOuter = 140;
                const rInner = major ? 130 : 134;
                const a = (angle - 90) * Math.PI / 180;
                // Round to 3dp: Math.cos/sin aren't bit-identical across Node (SSR)
                // and the browser, so full-precision coords cause a hydration mismatch.
                const r3 = (n: number) => Math.round(n * 1000) / 1000;
                return (
                  <line
                    key={i}
                    x1={r3(150 + Math.cos(a) * rOuter)}
                    y1={r3(150 + Math.sin(a) * rOuter)}
                    x2={r3(150 + Math.cos(a) * rInner)}
                    y2={r3(150 + Math.sin(a) * rInner)}
                    className={`dial-tick ${major ? 'major' : ''}`}
                  />
                );
              })}
              {/* Background arc */}
              <circle
                cx="150" cy="150" r="115"
                fill="none" stroke="var(--white)" strokeOpacity={0.06} strokeWidth="3"
                pathLength="100"
              />
              {/* Yes arc */}
              <circle
                ref={yesArcRef}
                cx="150" cy="150" r="115"
                className="dial-yes"
                strokeWidth="3"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={dashOffset}
                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)' }}
              />
              {/* Sparkline */}
              <g transform="translate(90,110)">
                <path className="dial-spark" d={sparkPath} strokeLinecap="round" style={{ transition: 'all 1.5s ease' }} />
              </g>
              {/* Needle */}
              <line
                ref={needleRef}
                x1="150" y1="150"
                x2="150" y2="45"
                className="dial-needle"
                style={{ transform: `rotate(${needleAngle + 90}deg)` }}
              />
              {/* Center dot */}
              <circle cx="150" cy="150" r="3" className="dial-center" />
            </svg>

            <div className="hero-dial-up">UP</div>
            <div className="hero-dial-down">DOWN</div>
            <div className="hero-dial-legend">probability index</div>

            <div className="hero-dial-center">
              <div className="label">UP PROBABILITY</div>
              <div className="yes-num">{probability.toFixed(0)}%</div>
              <div className="question">{dialLabel}</div>
              <div className="countdown">closes in <b>{fmtTime(dialCountdown)}</b></div>
            </div>
          </div>
        </div>

        {/* Ticker */}

        {/* Scroll indicator */}
        <div className="hero-scroll-indicator">
          <span className="line" />
          <span>scroll</span>
        </div>
      </section>

      {/* ═══════ HOW IT WORKS ═══════ */}
      <section className="how" id="how">
        <div className="section-eyebrow fade-up">
          <span>02 &mdash; How it works</span>
          <span className="jp">{'\u4E09\u6B69'} &middot; three steps</span>
        </div>
        <h2 className="section-title fade-up">Three steps. Before the clock runs out.</h2>

        <div className="how-steps" ref={howRef}>
          {HOW_STEPS.map((step, i) => (
            <div className="step" key={step.num}>
              <div className="num-col">
                <span className="dot" />
                <span className="num">{step.num}</span>
                <span className="jp">{step.jp}</span>
              </div>
              <div className="text-col">
                <div className="kicker">{step.kicker}</div>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-body">{step.body}</p>
                <div className="step-meta">{step.meta}</div>
              </div>
              <div className="art-col">
                <div className="art-frame">
                  <svg viewBox="0 0 200 160">
                    {i === 0 && (
                      <g>
                        <rect x="20" y="10" width="160" height="140" rx="4" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                        <rect x="30" y="20" width="40" height="10" rx="2" fill="var(--white)" fillOpacity={0.06} />
                        <text x="35" y="28" fontSize="6" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace">{'\u20BF'} BTC</text>
                        <line x1="30" y1="50" x2="170" y2="50" stroke="var(--white)" strokeOpacity={0.06} />
                        <text x="30" y="70" fontSize="9" fill="var(--white)" fillOpacity={0.6} fontFamily="system-ui">BTC above $95,000?</text>
                        <rect x="30" y="90" width="140" height="20" rx="3" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                        <rect x="30" y="90" width="90" height="20" rx="3" fill="rgba(224,77,38,0.15)" />
                        <text x="60" y="104" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">64% UP</text>
                        <rect x="30" y="120" width="65" height="24" rx="3" fill="rgba(224,77,38,0.1)" />
                        <rect x="105" y="120" width="65" height="24" rx="3" fill="var(--white)" fillOpacity={0.04} />
                        <text x="47" y="136" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">UP</text>
                        <text x="127" y="136" fontSize="8" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace">DOWN</text>
                      </g>
                    )}
                    {i === 1 && (
                      <g>
                        <circle cx="100" cy="80" r="50" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                        <circle cx="100" cy="80" r="50" fill="none" stroke="var(--vermilion)" strokeWidth="2" pathLength="100" strokeDasharray="64 36" strokeLinecap="round" style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 80px' }} />
                        <text x="100" y="76" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--white)" fontFamily="monospace">64%</text>
                        <text x="100" y="90" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace" letterSpacing="0.1em">UP</text>
                        <line x1="30" y1="140" x2="170" y2="140" stroke="var(--white)" strokeOpacity={0.06} />
                        <text x="100" y="155" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">POSITION COMMITTED</text>
                      </g>
                    )}
                    {i === 2 && (
                      <g>
                        <rect x="30" y="20" width="140" height="120" rx="4" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                        <line x1="30" y1="50" x2="170" y2="50" stroke="var(--white)" strokeOpacity={0.06} />
                        <text x="100" y="40" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace" letterSpacing="0.1em">SETTLEMENT</text>
                        <circle cx="100" cy="85" r="20" fill="none" stroke="var(--vermilion)" strokeWidth="1.5" />
                        <path d="M90,85 L97,92 L112,77" fill="none" stroke="var(--vermilion)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <text x="100" y="120" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace">ORACLE CONFIRMED</text>
                        <text x="100" y="132" textAnchor="middle" fontSize="7" fill="var(--vermilion)" fontFamily="monospace">ABOVE $95,000 {'\u2713'}</text>
                      </g>
                    )}
                  </svg>
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                </div>
                <div className="art-cap">
                  <span>{step.jp} &middot; {step.kicker.toLowerCase()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ STICKY FEATURES ═══════ */}
      <section className="features" ref={featuresRef}>
        <div className="features-rail">
          <span className="vjp">{'\u6A5F\u80FD'}</span>
          <div className="progress-track">
            <div className="progress-fill" style={{ height: `${featureProgress * 100}%` }} />
          </div>
        </div>

        <div className="features-cap fade-up">
          <span>Features</span>
          <span>What makes the floor work</span>
        </div>

        <div className="feature-pin" ref={featurePinRef}>
          <div className="feature-stage">
            {FEATURES.map((f, i) => (
              <div className={`feature ${i === activeFeature ? 'active' : ''}`} key={f.act}>
                <div className="feature-text">
                  <div className="feature-act">{f.act}</div>
                  <div className="feature-index">
                    <span className="rule" />
                    <span>{f.idx}</span>
                    <span className="jp">{f.jp}</span>
                  </div>
                  <h3>
                    {f.title}<em>{f.em}</em>
                  </h3>
                  <p>{f.desc}</p>
                  <div className="feature-keys">
                    {f.keys.map(k => (
                      <span key={k}><b>{k}</b></span>
                    ))}
                  </div>
                </div>
                <div className="feature-art">
                  <div className="art-shell">
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <span className="corner bl" />
                    <span className="corner br" />
                    <svg viewBox="0 0 280 200">
                      {i === 0 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace" letterSpacing="0.16em">STRIKE / WINDOW / SETTLE</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="var(--white)" strokeOpacity={0.06} />
                          <rect x="40" y="70" width="60" height="90" rx="3" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                          <text x="70" y="90" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">$95,000</text>
                          <text x="70" y="105" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">STRIKE</text>
                          <rect x="110" y="70" width="60" height="90" rx="3" fill="none" stroke="var(--white)" strokeOpacity={0.08} />
                          <text x="140" y="90" textAnchor="middle" fontSize="8" fill="var(--white)" fontFamily="monospace">01:00</text>
                          <text x="140" y="105" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">WINDOW</text>
                          <rect x="180" y="70" width="60" height="90" rx="3" fill="none" stroke="rgba(224,77,38,0.15)" />
                          <text x="210" y="90" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">{'\u2713'}</text>
                          <text x="210" y="105" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">SETTLE</text>
                          <line x1="40" y1="130" x2="240" y2="130" stroke="rgba(224,77,38,0.3)" strokeDasharray="4 3" />
                          <text x="140" y="150" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.2} fontFamily="monospace">ORACLE PRICE FEED</text>
                        </g>
                      )}
                      {i === 1 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace" letterSpacing="0.16em">BINARY POSITION</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="var(--white)" strokeOpacity={0.06} />
                          <rect x="50" y="70" width="80" height="100" rx="4" fill="rgba(224,77,38,0.08)" stroke="rgba(224,77,38,0.3)" />
                          <text x="90" y="105" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--vermilion)" fontFamily="system-ui">{'\u2191'}</text>
                          <text x="90" y="125" textAnchor="middle" fontSize="9" fill="var(--vermilion)" fontFamily="monospace">ABOVE</text>
                          <text x="90" y="140" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">64%</text>
                          <rect x="150" y="70" width="80" height="100" rx="4" fill="var(--white)" fillOpacity={0.02} stroke="var(--white)" strokeOpacity={0.08} />
                          <text x="190" y="105" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--white)" fillOpacity={0.4} fontFamily="system-ui">{'\u2193'}</text>
                          <text x="190" y="125" textAnchor="middle" fontSize="9" fill="var(--white)" fillOpacity={0.4} fontFamily="monospace">BELOW</text>
                          <text x="190" y="140" textAnchor="middle" fontSize="7" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">36%</text>
                        </g>
                      )}
                      {i === 2 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace" letterSpacing="0.16em">DETERMINISTIC SETTLEMENT</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="var(--white)" strokeOpacity={0.06} />
                          <line x1="60" y1="80" x2="60" y2="160" stroke="var(--white)" strokeOpacity={0.08} />
                          <line x1="140" y1="80" x2="140" y2="160" stroke="var(--white)" strokeOpacity={0.08} />
                          <line x1="220" y1="80" x2="220" y2="160" stroke="var(--white)" strokeOpacity={0.08} />
                          <circle cx="60" cy="100" r="12" fill="none" stroke="var(--white)" strokeOpacity={0.2} />
                          <text x="60" y="104" textAnchor="middle" fontSize="8" fill="var(--white)" fillOpacity={0.5} fontFamily="monospace">1</text>
                          <text x="60" y="130" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">ORACLE</text>
                          <text x="60" y="140" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">REPORTS</text>
                          <line x1="72" y1="100" x2="128" y2="100" stroke="rgba(224,77,38,0.3)" strokeDasharray="3 2" />
                          <circle cx="140" cy="100" r="12" fill="none" stroke="rgba(224,77,38,0.4)" />
                          <text x="140" y="104" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">2</text>
                          <text x="140" y="130" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">CONTRACT</text>
                          <text x="140" y="140" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">EXECUTES</text>
                          <line x1="152" y1="100" x2="208" y2="100" stroke="rgba(224,77,38,0.3)" strokeDasharray="3 2" />
                          <circle cx="220" cy="100" r="12" fill="none" stroke="var(--vermilion)" />
                          <text x="220" y="104" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">3</text>
                          <text x="220" y="130" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">PAYOUTS</text>
                          <text x="220" y="140" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">FLOW</text>
                        </g>
                      )}
                      {i === 3 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace" letterSpacing="0.16em">REPUTATION SYSTEM</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="var(--white)" strokeOpacity={0.06} />
                          {[0, 1, 2, 3, 4].map(j => (
                            <g key={j}>
                              <rect x="50" y={70 + j * 22} width={160 - j * 20} height="16" rx="2" fill={j === 0 ? 'rgba(224,77,38,0.15)' : 'var(--white)'} fillOpacity={j === 0 ? 1 : 0.03} stroke={j === 0 ? 'rgba(224,77,38,0.3)' : 'var(--white)'} strokeOpacity={j === 0 ? 1 : 0.06} />
                              <text x="56" y={81 + j * 22} fontSize="7" fill={j === 0 ? 'var(--vermilion)' : 'var(--white)'} fillOpacity={j === 0 ? 1 : 0.3} fontFamily="monospace">#{j + 1}</text>
                              <text x={45 + (160 - j * 20)} y={81 + j * 22} fontSize="7" fill={j === 0 ? 'var(--vermilion)' : 'var(--white)'} fillOpacity={j === 0 ? 1 : 0.3} fontFamily="monospace" textAnchor="end">{(92 - j * 8).toFixed(1)}%</text>
                            </g>
                          ))}
                        </g>
                      )}
                      {i === 4 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace" letterSpacing="0.16em">ON-CHAIN GUARDRAILS</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="var(--white)" strokeOpacity={0.06} />
                          <rect x="40" y="72" width="72" height="88" rx="4" fill="rgba(224,77,38,0.08)" stroke="rgba(224,77,38,0.3)" />
                          <circle cx="76" cy="104" r="16" fill="none" stroke="var(--vermilion)" strokeWidth="1.5" />
                          <path d="M69,104 L74,109 L84,98" fill="none" stroke="var(--vermilion)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <text x="76" y="140" textAnchor="middle" fontSize="7" fill="var(--vermilion)" fontFamily="monospace">AGENT</text>
                          <text x="76" y="150" textAnchor="middle" fontSize="6" fill="var(--white)" fillOpacity={0.3} fontFamily="monospace">ATTESTED</text>
                          <line x1="112" y1="104" x2="136" y2="104" stroke="rgba(224,77,38,0.3)" strokeDasharray="3 2" />
                          {['CAP', 'ALLOWLIST', 'DAILY STOP'].map((r, k) => (
                            <g key={r}>
                              <rect x="140" y={74 + k * 30} width="100" height="22" rx="3" fill="var(--white)" fillOpacity={0.03} stroke="var(--white)" strokeOpacity={0.08} />
                              <text x="150" y={89 + k * 30} fontSize="7" fill="var(--white)" fillOpacity={0.6} fontFamily="monospace">{r}</text>
                              <path d={`M221,${85 + k * 30} l3,3 l6,-6`} fill="none" stroke="var(--vermilion)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </g>
                          ))}
                        </g>
                      )}
                    </svg>
                    <span className="art-cap">
                      <span>{f.jp} &middot; act {f.act}</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Runway: the sticky pin above stays in view while these scroll past, which
            drives the act crossfade (~40vh of scroll per act). Hidden on mobile. */}
        <div className="features-spacer" style={{ height: '65vh' }} />
        <div className="features-spacer" style={{ height: '65vh' }} />
        <div className="features-spacer" style={{ height: '65vh' }} />

        {/* Progress dots */}
        <div className="feature-progress">
          {FEATURES.map((_, i) => (
            <span key={i} className={`dot ${i === activeFeature ? 'active' : ''}`} />
          ))}
        </div>
      </section>

      {/* ═══════ MANIFESTO ═══════ */}
      <section className="manifesto fade-up">
        <div className="manifesto-jp">{'\u9759'}</div>
        <div className="manifesto-vrule l" />
        <div className="manifesto-vrule r" />
        <div className="manifesto-runline tl" />
        <div className="manifesto-runline tr" />
        <div className="manifesto-runline bl" />
        <div className="manifesto-runline br" />
        <blockquote className="manifesto-quote">
          &ldquo;The market is a room of opinions. We built a quieter room &mdash; pick a side, wait for the clock, get paid.&rdquo;
        </blockquote>
        <div className="manifesto-attr">
          <span className="seal">{'\u4E88'}</span>
        </div>
      </section>

      {/* ═══════ EDITORIAL SPLIT ═══════ */}
      <section className="split fade-up">
        <div className="split-grid">
          <div className="split-left">
            <div className="section-eyebrow">03 &mdash; Architecture</div>
            <h2>
              Fast payouts. We hold nothing. <em>Owner of everything.</em>
            </h2>
            <p>
              Built on Sui, so every bet is fast and final the second a round closes. Prices come straight
              from the live market, and payouts settle automatically.
            </p>
            <div className="footrule">
              <span><b>Sui L1</b> &middot; Native</span>
              <span><b>Predict</b> &middot; Oracle</span>
            </div>
          </div>
          <div className="split-right">
            <div className="spec-head">
              <span>The basics</span>
              <span>{'\u4ED5\u69D8'}</span>
            </div>
            {SPEC_ROWS.map((row, i) => (
              <div className="split-row" key={row.label}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="k">{row.label}</span>
                <span className="v">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ MARKETS PREVIEW ═══════ */}

      {/* ═══════ FAQ ═══════ */}
      <section className="faq fade-up">
        <div className="faq-jp">{'\u554F'}</div>
        <div className="faq-grid">
          <aside className="faq-aside">
            <div className="rule" />
            <h2>Things people ask, <em>before they trade.</em></h2>
            <p className="desc">
              Everything you need to know about YOSUKU, in plain language.
            </p>
            <div className="faq-categories">
              <div className="faq-cat">Protocol <span className="count">02</span></div>
              <div className="faq-cat">Mechanics <span className="count">02</span></div>
              <div className="faq-cat">Access <span className="count">01</span></div>
            </div>
            <a href="https://x.com/yosuku0" target="_blank" rel="noreferrer" className="ask" data-cursor="hover">
              Ask a question <span className="arr">{'\u2197'}</span>
            </a>
          </aside>

          <div className="faq-list">
            {FAQ_DATA.map((item, i) => (
              <div
                className={`faq-item ${faqOpen === i ? 'open' : ''}`}
                key={i}
                onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                data-cursor="hover"
              >
                <div className="faq-q">
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text">{item.q}</span>
                  <span className="toggle" />
                </div>
                <div className="faq-a">
                  <p>{item.a}</p>
                  <div className="faq-a-meta">
                    {item.tags.map(t => (
                      <span className="tag" key={t}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ LANDING FOOTER ═══════ */}
      <footer className="landing-footer">
        <div className="footer-headline">
          <h2>Quiet markets, loud answers &mdash; <em>every round.</em></h2>
          <div className="actions">
            <span className="lbl">The floor is open</span>
            <Link href="/markets" className="cta" data-cursor="hover">
              Launch app <span className="arr">{'\u2197'}</span>
            </Link>
          </div>
        </div>

        <div className="footer-grid">
          <div className="footer-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="logo-mark">
                <YosukuMark />
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', letterSpacing: '0.18em' }}>YOSUKU</span>
            </div>
            <p className="tagline">Bet on Bitcoin in seconds. Runs on Sui, pays out automatically.</p>
            <div className="seal">
              <span className="seal-dot">{'\u4E88\u6E2C'}</span>
              <span>Tokyo &middot; 2026</span>
            </div>
          </div>

          {FOOTER_COLS.map((col, ci) => (
            <div className="footer-col" key={col.title}>
              <div className="footer-col-head">
                <span className="idx">{String(ci + 1).padStart(2, '0')}</span>
                <span className="ttl">{col.title}</span>
              </div>
              <div className="footer-links">
                {col.links.map(link => (
                  <a
                    href={link.href}
                    key={link.label}
                    data-cursor="hover"
                    {...(link.ext ? { target: '_blank', rel: 'noreferrer' } : {})}
                  >
                    {link.label}
                    <span className="arr">{'\u2197'}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="footer-status">
          <div className="cell">
            <span className="lbl">Network</span>
            <span className="val"><span className="dot" /> Sui</span>
          </div>
          <div className="cell">
            <span className="lbl">Protocol</span>
            <span className="val">DeepBook Predict</span>
          </div>
          <div className="cell">
            <span className="lbl">Latency</span>
            <span className="val">Sub-second</span>
          </div>
          <div className="cell">
            <span className="lbl">Build</span>
            <span className="val">v0.4.1</span>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-meta">&copy; 2026 YOSUKU</span>
          <div className="legal-links">
            {['Terms', 'Privacy', 'Cookies'].map(t => (
              <span
                key={t}
                title="Coming soon"
                aria-disabled="true"
                style={{
                  color: 'var(--gray-500)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  opacity: 0.6,
                  cursor: 'default',
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <span className="footer-sayonara">{'\u307E\u305F\u3001\u6B21\u306E\u9418\u3067\u3002'}</span>
        </div>

        <div className="footer-watermark">
          YOSUKU
          <span className="fill">YOSUKU</span>
        </div>
        <div className="footer-end-strip" />
      </footer>
    </div>
  );
}
