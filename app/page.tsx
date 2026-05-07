'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';

import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useOracles, useProtocolStats } from '@/lib/sui/hooks';
import { fetchLatestPrices, type PriceData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';

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
const STAT_SPARKS = [
  'M0,20 L8,14 L16,16 L24,8 L32,10 L40,4 L48,6 L56,2',
  'M0,18 L8,12 L16,14 L24,6 L32,8 L40,4 L48,10 L56,3',
  'M0,20 L8,16 L16,18 L24,10 L32,12 L40,6 L48,8 L56,4',
  'M0,10 L8,8 L16,12 L24,6 L32,4 L40,8 L48,3 L56,2',
];

const ASSET_GLYPH: Record<string, string> = {
  BTC: '\u20BF', ETH: '\u039E', SOL: 'S', SUI: '\u25E2',
};

const HOW_STEPS: HowStep[] = [
  { num: '01', jp: '\u5E02\u5834', kicker: 'Choose', title: 'Pick a market.', body: 'BTC, ETH, SOL, SUI \u2014 each with a strike price and a fifteen-minute window. One question: above or below at the bell.', meta: '4 assets \u00B7 15-min rounds \u00B7 continuous' },
  { num: '02', jp: '\u53D6\u5F15', kicker: 'Commit', title: 'Take a side.', body: 'One press. Your position is committed to Sui. No order books, no counterparties \u2014 just a binary stance and a fixed window.', meta: 'Binary \u00B7 Instant \u00B7 On-chain' },
  { num: '03', jp: '\u6C7A\u6E08', kicker: 'Settle', title: 'Settle automatically.', body: 'When the window closes, the oracle reports. Settlement is automatic. Winners receive proportional payouts. No claims, no friction.', meta: 'Oracle-settled \u00B7 Sub-second \u00B7 Trustless' },
];

const FEATURES: FeatureItem[] = [
  { act: '01', idx: 'I', title: 'Strike. Window. ', em: 'Settle.', desc: 'Every market has a strike price, a fifteen-minute window, and an oracle. When the bell rings, the chain decides. No ambiguity, no appeals.', keys: ['15-min rounds', 'Pyth oracle', 'Auto-settle'], jp: '\u89E3\u50CF' },
  { act: '02', idx: 'II', title: 'Two sides. ', em: 'One press.', desc: 'Pick above or below. Your position is committed instantly to Sui. No order books, no slippage, no counterparty risk.', keys: ['Binary positions', 'Instant commit', 'No slippage'], jp: '\u53D6\u5F15' },
  { act: '03', idx: 'III', title: 'The block ', em: 'decides.', desc: 'Settlement is deterministic. The oracle reports, the contract executes, payouts flow. Every step verifiable on-chain.', keys: ['Deterministic', 'Verifiable', 'Trustless'], jp: '\u6C7A\u6E08' },
  { act: '04', idx: 'IV', title: 'Accuracy ', em: 'compounds.', desc: 'The leaderboard is your track record. Consistent edge surfaces. Reputation is earned in fifteen-minute increments.', keys: ['Leaderboard', 'Track record', 'Reputation'], jp: '\u540D\u58F0' },
];

const FAQ_DATA: FaqItem[] = [
  { q: 'What does YOSUKU settle on?', a: 'Pyth Network price feeds on Sui. Every settlement is deterministic, verifiable on-chain, and independent of YOSUKU as an operator. The oracle reports; the contract executes.', tags: ['Oracle', 'Sui'], cat: 'Protocol' },
  { q: 'How does YOSUKU make money?', a: 'A small settlement fee (1-2%) is taken from the winning side of each market. There are no hidden spreads, no market-making positions, and no proprietary trading.', tags: ['Fees', 'Transparency'], cat: 'Protocol' },
  { q: 'Can I lose more than I stake?', a: 'No. Your maximum loss is your position size. There is no leverage, no margin, and no liquidation. Binary markets have a fixed downside by definition.', tags: ['Risk', 'Binary'], cat: 'Mechanics' },
  { q: 'Why fifteen-minute windows?', a: 'Short enough to be engaging and testable, long enough for genuine price discovery. Fifteen minutes is the smallest window where oracle latency is negligible relative to the round duration.', tags: ['Design', 'Cadence'], cat: 'Mechanics' },
  { q: 'Is this available in my country?', a: 'YOSUKU is a decentralised protocol on Sui. There is no geo-blocking at the protocol level. However, you are responsible for compliance with your local regulations.', tags: ['Legal', 'Access'], cat: 'Access' },
];

const SPEC_ROWS: SpecRow[] = [
  { label: 'Chain', value: 'Sui Network (L1)' },
  { label: 'Settlement', value: 'Pyth oracle, deterministic' },
  { label: 'Oracle', value: 'Pyth Network price feeds' },
  { label: 'Round cadence', value: '15 minutes, continuous' },
  { label: 'Asset', value: 'DUSDC (testnet stable)' },
  { label: 'Latency', value: 'Sub-second finality' },
  { label: 'Audits', value: 'In progress' },
];

const FOOTER_COLS = [
  { title: 'Product', links: ['Markets', 'Portfolio', 'Leaderboard', 'Docs'] },
  { title: 'Develop', links: ['GitHub', 'SDK', 'API', 'Status'] },
  { title: 'Society', links: ['Twitter / X', 'Discord', 'Blog', 'Brand'] },
  { title: 'Resources', links: ['Whitepaper', 'Audits', 'Terms', 'Privacy'] },
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
  const { active: liveOracles, loading: oraclesLoading } = useOracles();
  const { stats: protocolStats, loading: statsLoading } = useProtocolStats();
  const [oraclePrices, setOraclePrices] = useState<Record<string, PriceData>>({});

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

  /* ── Fetch prices for active oracles ── */
  useEffect(() => {
    if (liveOracles.length === 0) return;
    let cancelled = false;
    async function loadPrices() {
      const results = await Promise.allSettled(
        liveOracles.slice(0, 6).map(o => fetchLatestPrices(o.oracle_id))
      );
      if (cancelled) return;
      const newPrices: Record<string, PriceData> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          newPrices[liveOracles[i].oracle_id] = r.value;
        }
      });
      setOraclePrices(newPrices);
    }
    loadPrices();
    const interval = setInterval(loadPrices, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [liveOracles]);

  /* ── Derive probability from first oracle ── */
  useEffect(() => {
    if (liveOracles.length === 0) return;
    const firstOracle = liveOracles[0];
    const prices = oraclePrices[firstOracle.oracle_id];
    if (!prices) return;
    const numStrikes = 50;
    const midStrike = firstOracle.min_strike + firstOracle.tick_size * Math.floor(numStrikes / 2);
    const midStrikeDollars = midStrike / FLOAT_SCALING;
    const forward = prices.forward / FLOAT_SCALING;
    if (midStrikeDollars > 0 && forward > 0) {
      const diff = (forward - midStrikeDollars) / midStrikeDollars;
      const secsLeft = Math.max(60, (firstOracle.expiry * 1000 - Date.now()) / 1000);
      const sigma = 0.001 * Math.sqrt(secsLeft / 60);
      const z = diff / (sigma || 0.01);
      const p = Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z)))));
      setProbability(p);
    }
  }, [liveOracles, oraclePrices]);

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

  /* ── Real next-expiry countdown ── */
  const nextExpirySec = useMemo(() => {
    if (liveOracles.length === 0) return 0;
    const nearest = Math.min(...liveOracles.map(o => o.expiry));
    return Math.max(0, Math.floor(nearest - Date.now() / 1000));
  }, [liveOracles]);

  const [nextRound, setNextRound] = useState<number>(0);
  useEffect(() => {
    setNextRound(nextExpirySec);
  }, [nextExpirySec]);

  useEffect(() => {
    const iv = setInterval(() => {
      setNextRound(t => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ── Per-oracle dial countdown (first oracle) ── */
  const dialExpiry = useMemo(() => {
    if (liveOracles.length === 0) return 0;
    return Math.max(0, Math.floor(liveOracles[0].expiry - Date.now() / 1000));
  }, [liveOracles]);

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
    return liveOracles.slice(0, 6).map((oracle, i) => {
      const asset = oracle.underlying_asset || 'BTC';
      const glyph = ASSET_GLYPH[asset] || asset[0];
      const prices = oraclePrices[oracle.oracle_id];
      const numStrikes = 50;
      const midStrike = oracle.min_strike + oracle.tick_size * Math.floor(numStrikes / 2);
      const midStrikeDollars = midStrike / FLOAT_SCALING;

      let yesC = 50;
      if (prices) {
        const forward = prices.forward / FLOAT_SCALING;
        if (midStrikeDollars > 0 && forward > 0) {
          const diff = (forward - midStrikeDollars) / midStrikeDollars;
          const secsLeft = Math.max(60, (oracle.expiry * 1000 - Date.now()) / 1000);
          const sigma = 0.001 * Math.sqrt(secsLeft / 60);
          const z = diff / (sigma || 0.01);
          yesC = Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z)))));
        }
      }

      const secsLeft = Math.max(0, Math.floor(oracle.expiry - Date.now() / 1000));
      const formatStrike = (n: number) => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      const expDate = new Date(oracle.expiry * 1000);
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
      };
    });
  }, [liveOracles, oraclePrices]);

  /* ── Derive spot prices for ticker ── */
  const spotPrices = useMemo(() => {
    const byAsset: Record<string, number> = {};
    for (const oracle of liveOracles) {
      const asset = oracle.underlying_asset || 'BTC';
      const prices = oraclePrices[oracle.oracle_id];
      if (prices && !byAsset[asset]) {
        byAsset[asset] = prices.spot / FLOAT_SCALING;
      }
    }
    return byAsset;
  }, [liveOracles, oraclePrices]);

  /* ── Dial question label ── */
  const dialLabel = useMemo(() => {
    if (liveOracles.length === 0) return 'BTC > $95,000';
    const o = liveOracles[0];
    const asset = o.underlying_asset || 'BTC';
    const midStrike = o.min_strike + o.tick_size * 25;
    const dollars = midStrike / FLOAT_SCALING;
    return `${asset} > $${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }, [liveOracles]);

  /* ── IntersectionObserver for .how-steps ── */
  useEffect(() => {
    const el = howRef.current;
    if (!el) return;
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
      const progress = clamp(scrolled / (sectionH - window.innerHeight), 0, 1);
      setFeatureProgress(progress);
      const idx = Math.min(3, Math.floor(progress * 4));
      setActiveFeature(idx);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── Derived ── */
  const dashOffset = 100 - probability;
  const needleAngle = (probability / 100) * 360 - 90;
  const filteredMarkets = marketTab === 'All' ? displayMarkets : displayMarkets.filter(m => m.asset === marketTab);
  const marketTabs = ['All', 'BTC', 'ETH', 'SOL', 'SUI'];

  /* ── Stats band data from protocol ── */
  const statsData = [
    { idx: '01', label: 'Volume settled', value: protocolStats ? `$${(protocolStats.volumeSettled).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '\u2014', spark: STAT_SPARKS[0], meta: 'on-chain total' },
    { idx: '02', label: 'Markets resolved', value: protocolStats ? protocolStats.marketsResolved.toLocaleString() : '\u2014', spark: STAT_SPARKS[1], meta: 'oracle-settled' },
    { idx: '03', label: 'Active wallets', value: protocolStats ? protocolStats.activeWallets.toLocaleString() : '\u2014', spark: STAT_SPARKS[2], meta: 'unique managers' },
    { idx: '04', label: 'Settlement time', value: '< 1s', spark: STAT_SPARKS[3], meta: 'sub-second finality' },
  ];

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
            <span className="l1">Read the room &amp;</span>
            <span className="l2">before the room reads itself.</span>
          </h1>

          <p className="hero-sub">
            Binary prediction markets on Sui. Oracle-settled, fifteen-minute windows,
            sub-second finality. The floor is always open.
          </p>

          <div className="hero-cta-row">
            <Link href="/markets" className="btn btn-primary" data-cursor="hover">
              Take a side {'\u2197'}
            </Link>
            <a href="#how" className="btn btn-ghost" data-cursor="hover">
              How it works {'\u2193'}
            </a>
          </div>

          <div className="hero-pillrow">
            <span className="hero-pill">
              <span className="live-dot" />
              <span>{oraclesLoading ? '\u2014' : `${liveOracles.length} markets live`}</span>
            </span>
            <span className="hero-pill">
              <span className="live-dot" />
              <span>{protocolStats ? `${protocolStats.activeWallets} wallets` : '\u2014'}</span>
            </span>
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
                return (
                  <line
                    key={i}
                    x1={150 + Math.cos(a) * rOuter}
                    y1={150 + Math.sin(a) * rOuter}
                    x2={150 + Math.cos(a) * rInner}
                    y2={150 + Math.sin(a) * rInner}
                    className={`dial-tick ${major ? 'major' : ''}`}
                  />
                );
              })}
              {/* Background arc */}
              <circle
                cx="150" cy="150" r="115"
                fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3"
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
        <div className="hero-ticker">
          <div className="ticker-cell">
            <span className="ticker-label">BTC</span>
            <span className="ticker-value">
              {btcPrice ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : spotPrices.BTC ? `$${spotPrices.BTC.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '\u2014'}
            </span>
          </div>
          <div className="ticker-cell">
            <span className="ticker-label">ETH</span>
            <span className="ticker-value">
              {spotPrices.ETH ? `$${spotPrices.ETH.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '\u2014'}
            </span>
          </div>
          <div className="ticker-cell">
            <span className="ticker-label">SOL</span>
            <span className="ticker-value">
              {spotPrices.SOL ? `$${spotPrices.SOL.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '\u2014'}
            </span>
          </div>
          <div className="ticker-cell">
            <span className="ticker-label">Next round</span>
            <span className="ticker-value">{nextRound > 0 ? fmtTime(nextRound) : '\u2014'}</span>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="hero-scroll-indicator">
          <span className="line" />
          <span>scroll</span>
        </div>
      </section>

      {/* ═══════ STATS BAND ═══════ */}
      <section className="stats fade-up">
        <div className="stats-jp">{'\u6570'}</div>
        <div className="stats-grid">
          {statsData.map(s => (
            <div className="stat" key={s.idx}>
              <span className="stat-idx">{s.idx}</span>
              <span className="stat-label">{s.label}</span>
              <span className="stat-value">{s.value}</span>
              <svg className="stat-spark" viewBox="0 0 56 22" fill="none">
                <path d={s.spark} stroke="var(--vermilion)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span className="stat-meta">{s.meta}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ HOW IT WORKS ═══════ */}
      <section className="how" id="how">
        <div className="section-eyebrow fade-up">
          <span>02 &mdash; How it works</span>
          <span className="jp">{'\u4E09\u6B69'} &middot; three steps</span>
        </div>
        <h2 className="section-title fade-up">Three steps. Fifteen minutes. On-chain.</h2>

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
                        <rect x="20" y="10" width="160" height="140" rx="4" fill="none" stroke="rgba(255,255,255,0.08)" />
                        <rect x="30" y="20" width="40" height="10" rx="2" fill="rgba(255,255,255,0.06)" />
                        <text x="35" y="28" fontSize="6" fill="rgba(255,255,255,0.4)" fontFamily="monospace">{'\u20BF'} BTC</text>
                        <line x1="30" y1="50" x2="170" y2="50" stroke="rgba(255,255,255,0.06)" />
                        <text x="30" y="70" fontSize="9" fill="rgba(255,255,255,0.6)" fontFamily="system-ui">BTC above $95,000?</text>
                        <rect x="30" y="90" width="140" height="20" rx="3" fill="none" stroke="rgba(255,255,255,0.08)" />
                        <rect x="30" y="90" width="90" height="20" rx="3" fill="rgba(224,77,38,0.15)" />
                        <text x="60" y="104" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">64% UP</text>
                        <rect x="30" y="120" width="65" height="24" rx="3" fill="rgba(224,77,38,0.1)" />
                        <rect x="105" y="120" width="65" height="24" rx="3" fill="rgba(255,255,255,0.04)" />
                        <text x="47" y="136" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">UP</text>
                        <text x="127" y="136" fontSize="8" fill="rgba(255,255,255,0.4)" fontFamily="monospace">DOWN</text>
                      </g>
                    )}
                    {i === 1 && (
                      <g>
                        <circle cx="100" cy="80" r="50" fill="none" stroke="rgba(255,255,255,0.08)" />
                        <circle cx="100" cy="80" r="50" fill="none" stroke="var(--vermilion)" strokeWidth="2" pathLength="100" strokeDasharray="64 36" strokeLinecap="round" style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 80px' }} />
                        <text x="100" y="76" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--white)" fontFamily="monospace">64%</text>
                        <text x="100" y="90" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.4)" fontFamily="monospace" letterSpacing="0.1em">UP</text>
                        <line x1="30" y1="140" x2="170" y2="140" stroke="rgba(255,255,255,0.06)" />
                        <text x="100" y="155" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.3)" fontFamily="monospace">POSITION COMMITTED</text>
                      </g>
                    )}
                    {i === 2 && (
                      <g>
                        <rect x="30" y="20" width="140" height="120" rx="4" fill="none" stroke="rgba(255,255,255,0.08)" />
                        <line x1="30" y1="50" x2="170" y2="50" stroke="rgba(255,255,255,0.06)" />
                        <text x="100" y="40" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.4)" fontFamily="monospace" letterSpacing="0.1em">SETTLEMENT</text>
                        <circle cx="100" cy="85" r="20" fill="none" stroke="var(--vermilion)" strokeWidth="1.5" />
                        <path d="M90,85 L97,92 L112,77" fill="none" stroke="var(--vermilion)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <text x="100" y="120" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.4)" fontFamily="monospace">ORACLE CONFIRMED</text>
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
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.3)" fontFamily="monospace" letterSpacing="0.16em">STRIKE / WINDOW / SETTLE</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="rgba(255,255,255,0.06)" />
                          <rect x="40" y="70" width="60" height="90" rx="3" fill="none" stroke="rgba(255,255,255,0.08)" />
                          <text x="70" y="90" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">$95,000</text>
                          <text x="70" y="105" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">STRIKE</text>
                          <rect x="110" y="70" width="60" height="90" rx="3" fill="none" stroke="rgba(255,255,255,0.08)" />
                          <text x="140" y="90" textAnchor="middle" fontSize="8" fill="var(--white)" fontFamily="monospace">15:00</text>
                          <text x="140" y="105" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">WINDOW</text>
                          <rect x="180" y="70" width="60" height="90" rx="3" fill="none" stroke="rgba(224,77,38,0.15)" />
                          <text x="210" y="90" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">{'\u2713'}</text>
                          <text x="210" y="105" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">SETTLE</text>
                          <line x1="40" y1="130" x2="240" y2="130" stroke="rgba(224,77,38,0.3)" strokeDasharray="4 3" />
                          <text x="140" y="150" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)" fontFamily="monospace">ORACLE PRICE FEED</text>
                        </g>
                      )}
                      {i === 1 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.3)" fontFamily="monospace" letterSpacing="0.16em">BINARY POSITION</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="rgba(255,255,255,0.06)" />
                          <rect x="50" y="70" width="80" height="100" rx="4" fill="rgba(224,77,38,0.08)" stroke="rgba(224,77,38,0.3)" />
                          <text x="90" y="105" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--vermilion)" fontFamily="system-ui">{'\u2191'}</text>
                          <text x="90" y="125" textAnchor="middle" fontSize="9" fill="var(--vermilion)" fontFamily="monospace">ABOVE</text>
                          <text x="90" y="140" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.3)" fontFamily="monospace">64%</text>
                          <rect x="150" y="70" width="80" height="100" rx="4" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.08)" />
                          <text x="190" y="105" textAnchor="middle" fontSize="24" fontWeight="700" fill="rgba(255,255,255,0.4)" fontFamily="system-ui">{'\u2193'}</text>
                          <text x="190" y="125" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="monospace">BELOW</text>
                          <text x="190" y="140" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.3)" fontFamily="monospace">36%</text>
                        </g>
                      )}
                      {i === 2 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.3)" fontFamily="monospace" letterSpacing="0.16em">DETERMINISTIC SETTLEMENT</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="rgba(255,255,255,0.06)" />
                          <line x1="60" y1="80" x2="60" y2="160" stroke="rgba(255,255,255,0.08)" />
                          <line x1="140" y1="80" x2="140" y2="160" stroke="rgba(255,255,255,0.08)" />
                          <line x1="220" y1="80" x2="220" y2="160" stroke="rgba(255,255,255,0.08)" />
                          <circle cx="60" cy="100" r="12" fill="none" stroke="rgba(255,255,255,0.2)" />
                          <text x="60" y="104" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="monospace">1</text>
                          <text x="60" y="130" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">ORACLE</text>
                          <text x="60" y="140" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">REPORTS</text>
                          <line x1="72" y1="100" x2="128" y2="100" stroke="rgba(224,77,38,0.3)" strokeDasharray="3 2" />
                          <circle cx="140" cy="100" r="12" fill="none" stroke="rgba(224,77,38,0.4)" />
                          <text x="140" y="104" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">2</text>
                          <text x="140" y="130" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">CONTRACT</text>
                          <text x="140" y="140" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">EXECUTES</text>
                          <line x1="152" y1="100" x2="208" y2="100" stroke="rgba(224,77,38,0.3)" strokeDasharray="3 2" />
                          <circle cx="220" cy="100" r="12" fill="none" stroke="var(--vermilion)" />
                          <text x="220" y="104" textAnchor="middle" fontSize="8" fill="var(--vermilion)" fontFamily="monospace">3</text>
                          <text x="220" y="130" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">PAYOUTS</text>
                          <text x="220" y="140" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">FLOW</text>
                        </g>
                      )}
                      {i === 3 && (
                        <g>
                          <text x="140" y="40" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.3)" fontFamily="monospace" letterSpacing="0.16em">REPUTATION SYSTEM</text>
                          <line x1="40" y1="55" x2="240" y2="55" stroke="rgba(255,255,255,0.06)" />
                          {[0, 1, 2, 3, 4].map(j => (
                            <g key={j}>
                              <rect x="50" y={70 + j * 22} width={160 - j * 20} height="16" rx="2" fill={j === 0 ? 'rgba(224,77,38,0.15)' : 'rgba(255,255,255,0.03)'} stroke={j === 0 ? 'rgba(224,77,38,0.3)' : 'rgba(255,255,255,0.06)'} />
                              <text x="56" y={81 + j * 22} fontSize="7" fill={j === 0 ? 'var(--vermilion)' : 'rgba(255,255,255,0.3)'} fontFamily="monospace">#{j + 1}</text>
                              <text x={45 + (160 - j * 20)} y={81 + j * 22} fontSize="7" fill={j === 0 ? 'var(--vermilion)' : 'rgba(255,255,255,0.3)'} fontFamily="monospace" textAnchor="end">{(92 - j * 8).toFixed(1)}%</text>
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

        {/* Spacers for scroll-driven animation */}
        <div className="features-spacer" style={{ height: '15vh' }} />
        <div className="features-spacer" style={{ height: '15vh' }} />
        <div className="features-spacer" style={{ height: '15vh' }} />

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
          &ldquo;The market is a room of opinions. We built a quieter room &mdash; strike, window, settle.&rdquo;
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
              Sub-second settlement. Custodial of nothing. <em>Owner of everything.</em>
            </h2>
            <p>
              Built on Sui for parallel execution and instant finality. Pyth oracles for
              deterministic price feeds. No intermediaries between your position and your payout.
            </p>
            <div className="footrule">
              <span><b>Sui L1</b> &middot; Native</span>
              <span><b>Pyth</b> &middot; Oracle</span>
            </div>
          </div>
          <div className="split-right">
            <div className="spec-head">
              <span>Protocol specifications</span>
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
      <section className="markets-preview fade-up">
        <div className="section-eyebrow">
          <span>04 &mdash; Markets, right now</span>
        </div>
        <div className="markets-floor-head">
          <div className="lhs">
            <h2 className="section-title" style={{ marginBottom: 0 }}>Closing soon.</h2>
            <div className="sub">Live markets approaching settlement. Take a side before the window closes.</div>
          </div>
          <div className="markets-status">
            <div className="row">
              <span className="dot" />
              <span>Live</span>
            </div>
          </div>
        </div>

        <div className="markets-tabs">
          {marketTabs.map(tab => (
            <button
              key={tab}
              className={`markets-tab ${marketTab === tab ? 'active' : ''}`}
              onClick={() => setMarketTab(tab)}
              data-cursor="hover"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="lp-markets-grid">
          {filteredMarkets.length === 0 && !oraclesLoading && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 0', opacity: 0.4, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
              No active markets right now
            </div>
          )}
          {filteredMarkets.map((m, i) => (
            <Link href={`/markets/${m.oracleId}`} key={m.oracleId} className={`lp-market-card ${m.hot ? 'hot' : ''}`} data-cursor="hover">
              <div className="market-row1">
                <div className="market-glyph">{m.glyph}</div>
                <div className="market-asset-block">
                  <span className="market-asset">{m.asset}</span>
                  <span className="market-window">15-min</span>
                </div>
                <div className="spacer" />
                <span className={`lp-market-countdown ${m.secsLeft < 120 ? 'urgent' : ''}`}>
                  {fmtTime(m.secsLeft)}
                </span>
              </div>

              <div className="lp-market-question">{m.question}</div>

              <div className="lp-market-spark">
                <svg viewBox="0 0 160 40" preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: sparklineSVG(m.spark, 160, 40, 'rgba(255,255,255,0.25)') }} />
              </div>

              <div className="lp-market-prob">
                <div className="lp-market-prob-row">
                  <span className="yes">{m.yesC}% Up</span>
                  <span className="no">{100 - m.yesC}% Down</span>
                </div>
                <div className="lp-market-prob-bar">
                  <div className="fill" style={{ width: `${m.yesC}%` }} />
                </div>
              </div>

              <div className="lp-market-meta-row">
                <span>Vol {m.vol}</span>
                <span>{m.traders} traders</span>
              </div>

              <div className="lp-market-actions">
                <span className="lp-market-side up">Up</span>
                <span className="lp-market-side down">Down</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="markets-floor-foot">
          <Link href="/markets" className="arrow-link" data-cursor="hover">
            View all markets <span className="arr">{'\u2197'}</span>
          </Link>
        </div>
      </section>

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
            <a href="#" className="ask" data-cursor="hover">
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
          <h2>Quiet markets, loud answers &mdash; <em>every fifteen minutes.</em></h2>
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
              <svg viewBox="0 0 18 18" width="18" height="18">
                <line x1="9" y1="2" x2="9" y2="6" stroke="white" strokeWidth="1.4" />
                <line x1="9" y1="12" x2="9" y2="16" stroke="white" strokeWidth="1.4" />
                <rect x="6" y="6" width="6" height="6" fill="none" stroke="white" strokeWidth="1.4" />
                <circle cx="13" cy="6" r="1.4" fill="var(--vermilion)" />
              </svg>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', letterSpacing: '0.18em' }}>YOSUKU</span>
            </div>
            <p className="tagline">Prediction markets on Sui. Oracle-settled, sub-second finality.</p>
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
                  <a href="#" key={link} data-cursor="hover">
                    {link}
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
            <span className="val"><span className="dot" /> Sui Testnet</span>
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
            <span className="val">v0.4.1-testnet</span>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-meta">&copy; 2026 YOSUKU</span>
          <div className="legal-links">
            <a href="#" data-cursor="hover">Terms</a>
            <a href="#" data-cursor="hover">Privacy</a>
            <a href="#" data-cursor="hover">Cookies</a>
          </div>
          <span className="footer-sayonara">{'\u307E\u305F\u3001\u5341\u4E94\u5206\u5F8C\u306B\u3002'}</span>
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
