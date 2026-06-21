'use client';

/* eslint-disable @next/next/no-img-element */
// yosuku.xyz/pitch — the deck as a real, art-directed presentation.
// Editorial / Tokyo-fintech: asymmetric spreads, serif-italic accents, real product
// in device frames, staggered reveals, count-up stats. Nav: ← →, space, arrows, dots, swipe.
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, X, ShieldCheck, Smartphone, Activity, MessageSquare,
  Layers, Coins, TrendingUp, Sparkles, Wallet, BadgeDollarSign, Zap,
} from 'lucide-react';

/* ── motion ─────────────────────────────────────────────── */
const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
  exit: { opacity: 0, transition: { duration: 0.25 } },
};
const rise = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};
const M = motion.div;

/* ── primitives ─────────────────────────────────────────── */
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <M variants={rise} className="font-mono text-[11px] sm:text-xs tracking-[0.34em] uppercase text-vermilion">{children}</M>
);
const Serif = ({ children }: { children: React.ReactNode }) => (
  <span className="font-jp italic font-normal text-gray-300">{children}</span>
);
function Frame({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden border border-white/10 bg-[#0c0c0e] shadow-[0_50px_140px_-40px_rgba(0,0,0,0.95)] ${className}`}>
      <div className="flex items-center gap-1.5 px-3 h-7 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="w-2 h-2 rounded-full bg-white/12" /><span className="w-2 h-2 rounded-full bg-white/12" /><span className="w-2 h-2 rounded-full bg-vermilion/60" />
        <span className="ml-2 font-mono text-[9px] text-gray-600">yosuku.xyz</span>
      </div>
      <img src={src} alt={alt} className="block w-full" />
    </div>
  );
}
function Phone({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[26px] overflow-hidden border-[5px] border-[#17171b] bg-black shadow-[0_50px_140px_-40px_rgba(0,0,0,0.95)] ${className}`}>
      <img src={src} alt={alt} className="block w-full" />
    </div>
  );
}
function CountUp({ to, prefix = '', suffix = '', decimals = 0, dur = 1.3 }: { to: number; prefix?: string; suffix?: string; decimals?: number; dur?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / (dur * 1000));
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, dur]);
  return <>{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

/* ── slides ─────────────────────────────────────────────── */
const SLIDES: { id: string; render: () => React.ReactNode }[] = [
  {
    id: 'cover',
    render: () => (
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center w-full">
        <div>
          <Eyebrow>予測 · Pitch · Edition 04 / Tokyo 2026</Eyebrow>
          <M variants={rise} className="mt-7 font-display font-[800] tracking-tight text-white text-[clamp(3.4rem,9vw,7.5rem)] leading-[0.86]">Yosuku</M>
          <M variants={rise} className="mt-6 font-display font-bold text-[clamp(1.2rem,2.6vw,2rem)] text-white leading-[1.15] max-w-[20ch]">
            The consumer front door to <span className="text-vermilion">on-chain prediction markets</span>.
          </M>
          <M variants={rise} className="mt-5 text-[15px] sm:text-lg leading-relaxed max-w-[34ch] text-gray-400">
            One tap, <Serif>non-custodial</Serif>, built on DeepBook Predict — on web and a native mobile app.
          </M>
          <M variants={rise} className="mt-9 flex flex-wrap gap-2.5">
            {['18 wallets', '51 gas-free trades', '~1,800 SDK installs', 'live on Sui'].map((c) => (
              <span key={c} className="font-mono text-[10px] sm:text-[11px] tracking-wide text-gray-300 border border-white/12 rounded-full px-3 py-1.5">{c}</span>
            ))}
          </M>
        </div>
        <M variants={rise} className="relative">
          <div className="absolute -inset-10 bg-[radial-gradient(circle_at_60%_40%,rgba(224,77,38,0.18),transparent_70%)] blur-2xl" />
          <Frame src="/pitch/chart.png" alt="Yosuku live market" className="relative rotate-[1.5deg]" />
        </M>
      </div>
    ),
  },
  {
    id: 'problem',
    render: () => (
      <div className="grid lg:grid-cols-2 gap-14 items-center w-full">
        <div>
          <Eyebrow>01 — The problem</Eyebrow>
          <M variants={rise} className="mt-7 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.8rem)] leading-[1.04]">
            Markets price the future.<br /><Serif>Normal people can&apos;t get in.</Serif>
          </M>
        </div>
        <div className="space-y-3.5">
          {[
            ['Gas + jargon', 'Order books, strikes, fees before your first bet.'],
            ['Custody risk', 'Most apps make you hand over your keys.'],
            ['Disputed outcomes', 'Winners decided by committee votes, not data.'],
            ['No mobile, no social', 'Built for terminals — not for people.'],
          ].map(([h, d]) => (
            <M key={h} variants={rise} className="flex items-start gap-4 border-l-2 border-vermilion/40 pl-5 py-1">
              <div>
                <div className="font-display font-bold text-white text-lg">{h}</div>
                <div className="text-[13.5px] text-gray-400 leading-relaxed">{d}</div>
              </div>
            </M>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'solution',
    render: () => (
      <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-12 items-center w-full">
        <div>
          <Eyebrow>02 — The solution</Eyebrow>
          <M variants={rise} className="mt-7 font-display font-[800] tracking-tight text-white text-[clamp(2.4rem,6.5vw,5rem)] leading-[0.95]">
            One <span className="text-vermilion">tap</span>.<br />That&apos;s the<br /><Serif>whole thing.</Serif>
          </M>
          <M variants={rise} className="mt-7 text-[15px] sm:text-lg leading-relaxed max-w-[40ch] text-gray-400">
            Pick a side, see exactly what you&apos;d win, tap — gas-free. Non-custodial: only you can withdraw. Oracle-settled, not committee-voted.
          </M>
        </div>
        <M variants={rise} className="relative">
          <div className="absolute -inset-8 bg-[radial-gradient(circle_at_40%_50%,rgba(224,77,38,0.16),transparent_70%)] blur-2xl" />
          <Frame src="/pitch/chart.png" alt="Bet in one tap" className="relative -rotate-[1.5deg]" />
        </M>
      </div>
    ),
  },
  {
    id: 'product',
    render: () => (
      <div className="w-full">
        <Eyebrow>03 — The product</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.6rem)] leading-[1.02]">
          From scroll to settled, <Serif>in seconds.</Serif>
        </M>
        <div className="mt-9 grid lg:grid-cols-[1.5fr_0.8fr] gap-8 items-end">
          <M variants={rise} className="relative">
            <div className="absolute -inset-10 bg-[radial-gradient(circle_at_50%_60%,rgba(224,77,38,0.13),transparent_70%)] blur-2xl" />
            <Frame src="/pitch/chart.png" alt="Trade on Yosuku" className="relative" />
            <div className="mt-4 flex flex-wrap gap-2.5">
              {['Bet in 2 taps', 'Cash out mid-round', 'Trade from a tweet'].map((t) => (
                <span key={t} className="font-mono text-[11px] tracking-wide text-gray-300 border border-white/12 rounded-full px-3 py-1.5">{t}</span>
              ))}
            </div>
          </M>
          <M variants={rise} className="relative justify-self-center max-w-[260px]">
            <Phone src="/pitch/feed.png" alt="Yosuku feed" />
            <div className="mt-3 text-center font-mono text-[11px] tracking-wide text-gray-500">A feed of live markets — like short-form video.</div>
          </M>
        </div>
      </div>
    ),
  },
  {
    id: 'whynow',
    render: () => (
      <div className="w-full">
        <Eyebrow>04 — Why now</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2.2rem,5.5vw,4rem)] leading-[1.02]">The moment is <Serif>here.</Serif></M>
        <div className="mt-12 grid md:grid-cols-3 gap-8">
          {[
            ['Demand is proven', 'Prediction markets cleared billions in 2024 — and broke into the mainstream.'],
            ['The rails just shipped', 'DeepBook Predict brings oracle-settled markets to Sui.'],
            ['Consumer crypto is ready', 'Gasless, mobile, a stable unit — the UX this finally needs.'],
          ].map(([h, d], i) => (
            <M key={h} variants={rise}>
              <div className="font-display font-[800] text-vermilion/90 text-5xl leading-none">{`0${i + 1}`}</div>
              <div className="mt-4 font-display font-bold text-white text-xl">{h}</div>
              <div className="mt-2 text-[14px] text-gray-400 leading-relaxed">{d}</div>
            </M>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'whyus',
    render: () => (
      <div className="w-full">
        <Eyebrow>05 — Why us</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.6rem)] leading-[1.02]">
          Four things, together, <Serif>no one else has.</Serif>
        </M>
        <div className="mt-9 grid sm:grid-cols-2 gap-4">
          {[
            [ShieldCheck, 'Trade-from-X, no-divert custody', 'An agent trades for you — but by design can only return funds to you. Proven on-chain.'],
            [MessageSquare, 'Social by default', 'A feed + post-a-take turn opinions into tradeable markets.'],
            [Smartphone, 'Native mobile + gasless', 'First bet with zero friction, on iOS and Android.'],
            [Activity, 'Settlement integrity', 'Oracle-settled — no committee disputes.'],
          ].map(([Icon, h, d]) => {
            const I = Icon as typeof ShieldCheck;
            return (
              <M key={h as string} variants={rise} className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-5 flex gap-4">
                <I className="w-6 h-6 text-vermilion shrink-0 mt-0.5" />
                <div>
                  <div className="font-display font-bold text-white">{h as string}</div>
                  <div className="mt-1 text-[13px] text-gray-400 leading-relaxed">{d as string}</div>
                </div>
              </M>
            );
          })}
        </div>
      </div>
    ),
  },
  {
    id: 'market',
    render: () => (
      <div className="grid lg:grid-cols-2 gap-12 items-center w-full">
        <div>
          <Eyebrow>06 — Market</Eyebrow>
          <M variants={rise} className="mt-7 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.6rem)] leading-[1.04]">
            The consumer layer for a category going <Serif>mainstream.</Serif>
          </M>
        </div>
        <div className="space-y-4">
          {[
            ['Prediction markets', 'Billions in volume, entering mainstream culture.'],
            ['Consumer crypto', 'Tens of millions want simple, mobile, on-chain.'],
            ['On Sui', 'DeepBook is the infra — Yosuku is the product on top.'],
          ].map(([h, d], i) => (
            <M key={h} variants={rise} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 flex items-center gap-5">
              <span className="font-display font-[800] text-vermilion/80 text-3xl w-8">{`0${i + 1}`}</span>
              <div>
                <div className="font-display font-bold text-white text-lg">{h}</div>
                <div className="text-[13px] text-gray-400">{d}</div>
              </div>
            </M>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'traction',
    render: () => (
      <div className="w-full">
        <Eyebrow>07 — Traction</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2.2rem,5.5vw,4rem)] leading-[1.02]">
          Real usage. On-chain. <Serif>Verifiable.</Serif>
        </M>
        <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {[
            [<CountUp key="a" to={18} />, 'wallets placed gas-free trades'],
            [<CountUp key="b" to={51} />, 'sponsored on-chain actions'],
            [<CountUp key="c" to={1870} prefix="~" />, 'installs · SDK + MCP'],
            ['iOS + Android', 'native app, on TestFlight'],
          ].map(([n, d], i) => (
            <M key={i} variants={rise}>
              <div className="font-display font-[800] text-vermilion text-[clamp(2.2rem,5vw,4rem)] leading-none tabular-nums">{n}</div>
              <div className="mt-3 text-[13px] text-gray-400 leading-snug max-w-[18ch]">{d as string}</div>
            </M>
          ))}
        </div>
        <M variants={rise} className="mt-12 font-mono text-[11px] tracking-wide text-gray-600">Live on Sui testnet · every figure checkable on-chain.</M>
      </div>
    ),
  },
  {
    id: 'tech',
    render: () => (
      <div className="w-full">
        <Eyebrow>08 — How it&apos;s built</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.4rem)] leading-[1.02]">
          DeepBook Predict for the markets. <Serif>Our Move for the moat.</Serif>
        </M>
        <div className="mt-10 space-y-3.5 max-w-3xl">
          {[
            [Layers, 'DeepBook Predict', 'Oracle-settled markets — Mysten’s on-chain prediction engine.'],
            [ShieldCheck, 'Yosuku Move modules', 'No-divert agent custody, Trading Balance (leverage / private), PLP vault yield.'],
            [Zap, 'SDK + MCP + attested keeper', 'Open, reusable, verifiable — published on npm.'],
          ].map(([Icon, h, d], i) => {
            const I = Icon as typeof Layers;
            return (
              <M key={h as string} variants={rise} className="flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <span className="font-mono text-[10px] text-gray-600 mt-1 w-6">{`L${i + 1}`}</span>
                <I className="w-6 h-6 text-vermilion shrink-0 mt-0.5" />
                <div>
                  <div className="font-display font-bold text-white">{h as string}</div>
                  <div className="mt-1 text-[13px] text-gray-400 leading-relaxed">{d as string}</div>
                </div>
              </M>
            );
          })}
        </div>
        <M variants={rise} className="mt-7 font-mono text-[11px] tracking-wide text-gray-600">Non-custodial · open · verifiable on-chain.</M>
      </div>
    ),
  },
  {
    id: 'business',
    render: () => (
      <div className="w-full">
        <Eyebrow>09 — Business model</Eyebrow>
        <M variants={rise} className="mt-6 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.6rem)] leading-[1.02]">
          We earn when the market <Serif>works.</Serif>
        </M>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            [Coins, 'Vault spread', 'Be the house — earn the protocol spread (PLP).'],
            [TrendingUp, 'Leverage premium', 'The reserve charges for boosted exposure.'],
            [BadgeDollarSign, 'Builder fees', 'On volume, when DeepBook enables them.'],
            [Sparkles, 'Strategy market', 'Copy-trade fees on agent strategies.'],
          ].map(([Icon, h, d]) => {
            const I = Icon as typeof Coins;
            return (
              <M key={h as string} variants={rise} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <I className="w-5 h-5 text-vermilion mb-3" />
                <div className="font-display font-bold text-white">{h as string}</div>
                <div className="mt-1 text-[13px] text-gray-400 leading-relaxed">{d as string}</div>
              </M>
            );
          })}
        </div>
      </div>
    ),
  },
  {
    id: 'team',
    render: () => (
      <div className="grid lg:grid-cols-2 gap-12 items-center w-full">
        <div>
          <Eyebrow>10 — Team</Eyebrow>
          <M variants={rise} className="mt-7 font-display font-[800] tracking-tight text-white text-[clamp(2rem,5vw,3.6rem)] leading-[1.04]">
            Builders who ship at the speed this category <Serif>demands.</Serif>
          </M>
          <M variants={rise} className="mt-6 text-[15px] sm:text-lg text-gray-400 leading-relaxed max-w-[44ch]">
            A full consumer product — web, native mobile, on-chain Move, and published SDKs — all live on testnet.
          </M>
        </div>
        <div className="flex flex-wrap gap-2.5 self-center">
          {['Consumer web app', 'Native iOS + Android', 'Move contracts on Sui', '@yosuku SDK + MCP on npm', 'Attested agent keeper'].map((t) => (
            <M key={t} variants={rise} className="font-mono text-[12px] tracking-wide text-gray-200 border border-white/12 rounded-full px-4 py-2.5">{t}</M>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'close',
    render: () => (
      <div className="flex flex-col items-center text-center w-full">
        <Eyebrow>11 — Vision</Eyebrow>
        <M variants={rise} className="mt-8 font-display font-[800] tracking-tight text-white leading-[1.04] text-[clamp(2.2rem,6vw,4.4rem)] max-w-[16ch]">
          The front door to <Serif>on-chain prediction markets</Serif>.
        </M>
        <M variants={rise} className="mt-9 grid sm:grid-cols-2 gap-4 max-w-2xl text-left w-full">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1">Today</div><div className="text-[14px] text-gray-200">Live on Sui testnet — bet, cash out, trade-from-X, earn.</div></div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1">Next</div><div className="text-[14px] text-gray-200">Mainnet, more assets, deeper social.</div></div>
        </M>
        <M variants={rise}>
          <a href="https://yosuku.xyz" className="mt-10 inline-block font-display font-[800] text-vermilion text-[clamp(1.6rem,4.5vw,2.8rem)] tracking-tight hover:text-white transition-colors">yosuku.xyz</a>
        </M>
      </div>
    ),
  },
];

/* ── deck shell ─────────────────────────────────────────── */
export default function PitchPage() {
  const [[index, dir], setNav] = useState<[number, number]>([0, 0]);
  const total = SLIDES.length;
  const touchX = useRef<number | null>(null);

  const go = useCallback((d: number) => setNav(([i]) => {
    const n = Math.min(total - 1, Math.max(0, i + d));
    return n === i ? [i, 0] : [n, d];
  }), [total]);
  const goto = useCallback((i: number) => setNav(([cur]) => [i, i > cur ? 1 : -1]), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') goto(0);
      else if (e.key === 'End') goto(total - 1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, goto, total]);

  return (
    <div
      className="fixed inset-0 bg-[#08080b] text-white overflow-hidden select-none"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touchX.current = null; }}
    >
      {/* depth: vermilion glow + kanji + grain */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(224,77,38,0.10),transparent_55%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-[7vw] top-1/2 -translate-y-1/2 font-jp font-bold text-white/[0.018] leading-none" style={{ fontSize: '44vw' }}>予</div>

      {/* progress */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/[0.06] z-30">
        <motion.div className="h-full bg-vermilion" animate={{ width: `${((index + 1) / total) * 100}%` }} transition={{ ease: [0.4, 0, 0.2, 1], duration: 0.4 }} style={{ boxShadow: '0 0 10px var(--vermilion)' }} />
      </div>

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 sm:px-12 py-5 z-30">
        <Link href="/" className="font-display font-extrabold tracking-tight text-white/90 hover:text-white transition-colors">YOSUKU</Link>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[11px] tracking-widest text-gray-500 tabular-nums">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
          <Link href="/" aria-label="Exit deck" className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></Link>
        </div>
      </div>

      {/* stage */}
      <div className="absolute inset-0 flex items-center justify-center px-6 sm:px-14 lg:px-24 pt-16 pb-20">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={SLIDES[index].id} variants={stagger} initial="hidden" animate="show" exit="exit" className="w-full max-w-6xl">
            {SLIDES[index].render()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* arrows */}
      <button onClick={() => go(-1)} disabled={index === 0} aria-label="Previous" className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur flex items-center justify-center text-gray-400 hover:text-white hover:border-white/25 transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button onClick={() => go(1)} disabled={index === total - 1} aria-label="Next" className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur flex items-center justify-center text-gray-400 hover:text-white hover:border-white/25 transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
        <ArrowRight className="w-5 h-5" />
      </button>

      {/* dots + hint */}
      <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-2 z-30">
        {SLIDES.map((s, i) => (
          <button key={s.id} onClick={() => goto(i)} aria-label={`Slide ${i + 1}`} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-7 bg-vermilion' : 'w-1.5 bg-white/20 hover:bg-white/40'}`} />
        ))}
      </div>
      <div className="absolute bottom-6 right-6 hidden sm:block font-mono text-[10px] tracking-widest text-gray-700 z-30">← → to navigate</div>
    </div>
  );
}
