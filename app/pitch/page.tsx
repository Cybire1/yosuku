'use client';

/* eslint-disable @next/next/no-img-element */
// yosuku.xyz/pitch — "THE YOSUKU FOLIO": the deck as one authored premium issue.
// Content rewritten to the Sui Overflow rubric, grounded in the real codebase (honest,
// evidence-cited). Warm cream editorial on a construction-frame system. Emphasis is the
// "stub" perforation underline. Nav: ← → space, dots, click.
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';

/* ── palette (vermilion rationed hard: eyelet, ticks, one or two accents) ── */
const PAPER = '#F1EADC';
const PAPER2 = '#F4EEE3';
const CARD = '#FBF7EF';
const INK = '#141210';
const VERM = '#E04D26';
const GREEN = '#2E6B4F';
const BODY = 'rgba(20,18,16,0.82)';
const MUTE = 'rgba(20,18,16,0.62)';
const FAINT = 'rgba(20,18,16,0.48)';
const HAIR = 'rgba(20,18,16,0.14)';
const SOFT = 'rgba(20,18,16,0.03)';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } }, exit: { opacity: 0, transition: { duration: 0.22 } } };
const rise = { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } };
const M = motion.div;

/* ── the "stub": ticket-perforation emphasis ── */
function Emph({ children, delay = 0.55 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-block" style={{ padding: '0 0.05em' }}>
      <span className="relative" style={{ zIndex: 1 }}>{children}</span>
      <motion.span aria-hidden className="absolute" style={{
        left: 0, right: '0.14em', bottom: '-0.16em', height: 4, zIndex: 0, transformOrigin: 'left',
        backgroundImage: `radial-gradient(circle at center, ${INK} 0 1.4px, transparent 1.7px)`,
        backgroundSize: '8px 4px', backgroundRepeat: 'repeat-x',
      }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay, duration: 0.5, ease: EASE }} />
      <motion.span aria-hidden className="absolute rounded-full" style={{ right: '-0.02em', bottom: '-0.21em', width: 6, height: 6, background: VERM, zIndex: 2 }}
        initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: delay + 0.5, type: 'spring', stiffness: 480, damping: 17 }} />
    </span>
  );
}

const Mono = ({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) =>
  <span className={`font-mono uppercase ${className}`} style={{ letterSpacing: '0.16em', ...style }}>{children}</span>;

function Kicker({ children }: { children: React.ReactNode }) {
  return <M variants={rise} className="inline-flex items-center gap-2 font-mono uppercase" style={{ fontSize: 11, letterSpacing: '0.2em', color: MUTE, marginBottom: 16 }}>
    <span style={{ width: 7, height: 7, background: INK }} />{children}
  </M>;
}
function Pill({ children, tone = 'ink', icon }: { children: React.ReactNode; tone?: 'ink' | 'live' | 'verm'; icon?: React.ReactNode }) {
  const c = tone === 'live' ? GREEN : tone === 'verm' ? VERM : MUTE;
  return <span className="inline-flex items-center gap-2 font-mono uppercase rounded" style={{ fontSize: 10.5, letterSpacing: '0.08em', padding: '6px 11px', border: `1px solid ${HAIR}`, background: CARD, color: c }}>
    {icon ? <span className="inline-flex items-center">{icon}</span> : <span className="rounded-full" style={{ width: 6, height: 6, background: 'currentColor' }} />}{children}
  </span>;
}

/* ── brand marks (monochrome ink, custom SVG) ── */
const LogoX = ({ s = 12, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 1200 1227" fill={c}><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z" /></svg>;
const LogoGoogle = ({ s = 13, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 48 48" fill={c}>
    <path d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
    <path d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
    <path d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
    <path d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
  </svg>;
const LogoCard = ({ s = 22, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s * 0.7} viewBox="0 0 32 22" fill="none"><rect x="1.2" y="1.2" width="29.6" height="19.6" rx="3.2" stroke={c} strokeWidth="2.2" /><rect x="1.2" y="5.6" width="29.6" height="3.6" fill={c} /><rect x="5" y="14" width="9" height="2.6" rx="1.3" fill={c} /></svg>;
const LogoSui = ({ s = 19, c = INK }: { s?: number; c?: string }) =>
  <svg width={s * 0.8} height={s} viewBox="0 0 100 124" fill={c}><path d="M50 6C50 6 14 51 14 81a36 36 0 1 0 72 0C86 51 50 6 50 6Z" /></svg>;
function Celebrant({ h = 46 }: { h?: number }) {
  return (
    <svg width={h * 0.83} height={h} viewBox="0 0 266 322" fill="none">
      <g stroke={INK} strokeLinecap="round">
        <line x1="12" y1="15" x2="88" y2="94" strokeWidth="24" /><line x1="254" y1="15" x2="178" y2="94" strokeWidth="24" />
        <line x1="132.5" y1="13" x2="132.5" y2="86" strokeWidth="14" /><line x1="132.5" y1="250" x2="132.5" y2="306" strokeWidth="14" />
      </g>
      <rect x="99" y="78" width="67" height="166" rx="16" fill={INK} /><circle cx="132.5" cy="239" r="11" fill={VERM} />
    </svg>
  );
}
const Kanji = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) =>
  <span className={`font-jp font-bold select-none ${className}`} style={style}>予</span>;

// labeled image placeholder (drop real screenshots later)
function Drop({ label, tag = 'DROP IMAGE', w = 260, h = 300, tilt = 0 }: { label: string; tag?: string; w?: number | string; h?: number; tilt?: number }) {
  return (
    <M variants={rise} className="relative shrink-0 flex flex-col items-center justify-center text-center" style={{ width: w, height: h, transform: `rotate(${tilt}deg)`, border: `1.5px dashed ${HAIR}`, borderRadius: 12, background: SOFT, padding: 24 }}>
      <Mono className="text-[10px]" style={{ color: VERM, letterSpacing: '0.22em' }}>{tag}</Mono>
      <div className="font-mono mt-3" style={{ fontSize: 12, color: MUTE, lineHeight: 1.5, maxWidth: '90%' }}>{label}</div>
    </M>
  );
}

// clean Move code chip
function CodeChip({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{ width: 380, background: '#17140F', borderRadius: 14, boxShadow: '0 40px 90px -44px rgba(40,28,18,0.6)', overflow: 'hidden', ...style }}>
      <div className="flex items-center gap-1.5 px-4" style={{ height: 32, background: 'rgba(255,255,255,0.04)' }}>
        <span className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.14)' }} /><span className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.14)' }} /><span className="rounded-full" style={{ width: 8, height: 8, background: VERM }} />
        <Mono className="text-[9px] ml-2" style={{ color: 'rgba(255,255,255,0.4)' }}>vault624.move</Mono>
      </div>
      <div className="p-5 font-mono text-[12.5px]" style={{ color: '#E8E2D4', lineHeight: 1.7 }}>
        <div><span style={{ color: '#C05CD8' }}>public fun</span> <span style={{ color: '#5B8DEF' }}>agent_open</span>(...) {'{'}</div>
        <div className="pl-4" style={{ color: 'rgba(255,255,255,0.5)' }}>// the agent can only open a</div>
        <div className="pl-4" style={{ color: 'rgba(255,255,255,0.5)' }}>// position the owner owns. no</div>
        <div className="pl-4" style={{ color: 'rgba(255,255,255,0.5)' }}>// withdraw path exists for it.</div>
        <div className="pl-4"><span style={{ color: '#2FA47C' }}>transfer</span>(win, <span style={{ color: VERM }}>owner</span>);</div>
        <div>{'}'}</div>
      </div>
    </div>
  );
}

// perforated dotted leader (echoes the ticket stub)
const dots = (color = HAIR): React.CSSProperties => ({ backgroundImage: `radial-gradient(circle at center, ${color} 0 1.3px, transparent 1.6px)`, backgroundSize: '7px 3px', backgroundRepeat: 'repeat-x' });

// receipt/ledger stub (our own data presentation)
function SpecPanel({ title, badge, badgeTone = 'live', rows, w }: { title: string; badge?: string; badgeTone?: 'live' | 'verm'; rows: [string, React.ReactNode, boolean?][]; w?: number | string }) {
  return (
    <M variants={rise} style={{ width: w ?? 400 }}>
      <div className="flex items-center justify-between" style={{ paddingBottom: 8 }}>
        <Mono className="text-[10.5px]" style={{ color: INK }}>{title}</Mono>
        {badge && <Mono className="text-[10px]" style={{ color: badgeTone === 'live' ? GREEN : VERM }}>{badge}</Mono>}
      </div>
      <div className="relative" style={{ height: 2, background: INK }}>
        <span className="absolute rounded-full" style={{ right: 0, top: '50%', transform: 'translate(50%,-50%)', width: 6, height: 6, background: VERM }} />
      </div>
      <div style={{ marginTop: 3 }}>
        {rows.map(([k, v, hl], i) => (
          <div key={i} className="flex items-baseline" style={{ padding: '9px 0' }}>
            <Mono className="text-[11px]" style={{ color: MUTE, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{k}</Mono>
            <span aria-hidden className="flex-1" style={{ height: 3, margin: '0 12px', transform: 'translateY(-3px)', ...dots() }} />
            <span className="font-mono" style={{ fontSize: 13.5, color: hl ? GREEN : INK, whiteSpace: 'nowrap' }}>{v}</span>
          </div>
        ))}
      </div>
    </M>
  );
}

// cover hero facts: bold Sora values
function Glance({ rows, w = 440 }: { rows: [string, React.ReactNode, boolean?][]; w?: number }) {
  return (
    <M variants={rise} style={{ width: w }}>
      <div className="flex items-center justify-between" style={{ paddingBottom: 11 }}>
        <Mono className="text-[11px]" style={{ color: INK }}>AT A GLANCE</Mono>
        <Mono className="text-[10.5px]" style={{ color: GREEN }}>LIVE ON TESTNET</Mono>
      </div>
      <div className="relative" style={{ height: 2, background: INK }}>
        <span className="absolute rounded-full" style={{ right: 0, top: '50%', transform: 'translate(50%,-50%)', width: 6, height: 6, background: VERM }} />
      </div>
      {rows.map(([k, v, hl], i) => (
        <div key={i} className="flex items-center justify-between gap-6" style={{ padding: '11px 0', minHeight: 42, borderBottom: i < rows.length - 1 ? `1px solid ${HAIR}` : 'none' }}>
          <Mono className="text-[10.5px]" style={{ color: FAINT, whiteSpace: 'nowrap' }}>{k}</Mono>
          {typeof v === 'string'
            ? <span className="font-display font-[600] text-right" style={{ fontSize: 20, color: hl ? GREEN : INK, letterSpacing: '-0.015em', lineHeight: 1.1 }}>{v}</span>
            : <span className="flex items-center gap-2.5">{v}</span>}
        </div>
      ))}
    </M>
  );
}

function StatCard({ value, label, source, hl }: { value: React.ReactNode; label: string; source?: string; hl?: boolean }) {
  return (
    <M variants={rise} className="flex-1">
      <div className="font-display font-[800]" style={{ fontSize: 'clamp(1.9rem,3.6vw,3.1rem)', letterSpacing: '-0.035em', lineHeight: 0.9, color: hl ? GREEN : INK }}>{value}</div>
      <div aria-hidden style={{ height: 3, width: '46%', margin: '14px 0 12px', ...dots(INK) }} />
      <div className="font-mono uppercase" style={{ fontSize: 12, letterSpacing: '0.09em', color: BODY, lineHeight: 1.5 }}>{label}</div>
      {source && <div className="mt-2.5 font-mono" style={{ fontSize: 11, color: MUTE, letterSpacing: '0.04em' }}>{source}</div>}
    </M>
  );
}

// now/next/then + phase cards
function PhaseCard({ tag, title, body, tone = 'ink' }: { tag: string; title: string; body: string; tone?: 'ink' | 'live' }) {
  return (
    <M variants={rise} className="flex-1" style={{ background: CARD, border: `1px solid ${HAIR}`, borderLeft: `3px solid ${tone === 'live' ? GREEN : INK}`, borderRadius: 8, padding: '18px 20px' }}>
      <Mono className="text-[10px]" style={{ color: tone === 'live' ? GREEN : VERM }}>{tag}</Mono>
      <div className="font-display font-[700] mt-2" style={{ fontSize: 19, color: INK, letterSpacing: '-0.01em' }}>{title}</div>
      <div className="mt-2 font-mono" style={{ fontSize: 12.5, color: BODY, lineHeight: 1.5 }}>{body}</div>
    </M>
  );
}

function CountUp({ to, decimals = 0, dur = 1.4, prefix = '' }: { to: number; decimals?: number; dur?: number; prefix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => { let raf = 0; let s = 0; const tick = (t: number) => { if (!s) s = t; const p = Math.min(1, (t - s) / (dur * 1000)); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [to, dur]);
  return <>{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

const H1 = 'font-display font-[700] text-[#141210] tracking-[-0.03em] leading-[0.94]';
const ARTSIZE = { fontSize: 'clamp(2.4rem,6.8vw,5.6rem)' };
const DENSE = { fontSize: 'clamp(1.9rem,3.9vw,3.2rem)' };
const lead: React.CSSProperties = { color: BODY, fontSize: 'clamp(14px,1.55vw,17.5px)', lineHeight: 1.55, maxWidth: '46ch' };

/* ── the issue: 14 spreads, one per rubric beat ── */
const SLIDES: { id: string; section: string; paper?: string; render: () => React.ReactNode }[] = [
  // 01 · AT A GLANCE (problem/solution/value prop + presentation)
  {
    id: 'glance', section: 'COVER',
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <div className="relative z-10" style={{ maxWidth: '52%' }}>
          <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2.4rem,6.2vw,5.2rem)' }}>
            Bet Bitcoin.<br />Only you can <Emph delay={0.7}>cash out</Emph>.
          </M>
          <M variants={rise} className="mt-6 font-mono" style={{ ...lead, maxWidth: '50ch' }}>
            The one-tap Bitcoin prediction market on Sui. Bet Up or Down, or straight from a tweet, through an agent that can open your position but never withdraw. Sign in with Google, no seed phrase. <span style={{ color: INK }}>Live on testnet.</span>
          </M>
          <M variants={rise} className="mt-7 flex gap-2.5 flex-wrap">
            <Pill tone="live">Live on testnet</Pill><Pill>Web · iOS · X</Pill><Pill tone="verm">Built on Sui</Pill>
          </M>
        </div>
        <Glance rows={[
          ['Category', 'Bitcoin prediction market'],
          ['Bet by', 'One tap, or a tweet'],
          ['Custody', 'Non-custodial', true],
          ['Onboarding', (<span className="flex items-center gap-3"><LogoGoogle s={19} /><span style={{ color: FAINT }}>·</span><LogoCard s={24} /><span style={{ color: FAINT }}>·</span><LogoX s={16} /></span>)],
          ['Real usage', '88 wallets · /stats', true],
          ['Built on', (<span className="flex items-center gap-2.5"><LogoSui s={20} /><span className="font-display font-[600]" style={{ fontSize: 20, color: INK, letterSpacing: '-0.015em' }}>Sui</span></span>)],
        ]} />
      </div>
    ),
  },

  // 02 · PROBLEM
  {
    id: 'problem', section: 'PROBLEM', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '54%' }}>
          <Kicker>The problem</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>The app that trades<br />for you can <Emph delay={0.7}>drain you</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            Custodial betting apps hold your balance, so they can freeze you out of your own winnings. The new AI trading agents are worse: a prompt-injected agent can move your money somewhere you never chose. And real self-custody still means seed phrases, a gas token, and an order book.
          </M>
        </div>
        <M variants={rise} className="absolute" style={{ right: 0, top: '50%', transform: 'translateY(-50%) rotate(4deg)' }}>
          <div className="relative" style={{ width: 270, background: '#EDE3D0', borderRadius: 16, boxShadow: '0 36px 80px -38px rgba(40,28,18,0.42)', padding: '40px 26px', filter: 'saturate(0.5)' }}>
            <Mono className="text-[10px]" style={{ color: FAINT }}>ACCOUNT · LIMITED</Mono>
            <div className="mt-7 flex items-center justify-center">
              <span className="font-display font-[800] text-[24px]" style={{ color: VERM, border: `3px solid ${VERM}`, padding: '7px 20px', borderRadius: 8, transform: 'rotate(-6deg)', letterSpacing: '0.05em' }}>FROZEN</span>
            </div>
            <div className="mt-7 rounded-lg flex items-center justify-center" style={{ height: 40, background: 'rgba(20,18,16,0.08)' }}>
              <Mono className="text-[10px]" style={{ color: FAINT }}>WITHDRAWALS DISABLED</Mono>
            </div>
            <div className="mt-5"><Mono className="text-[9px]" style={{ color: FAINT }}>PLATE · A CUSTODIAL APP</Mono></div>
          </div>
        </M>
      </div>
    ),
  },

  // 03 · SOLUTION + value prop
  {
    id: 'solution', section: 'SOLUTION',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>The solution</Kicker>
        <M variants={rise} className={`${H1}`} style={ARTSIZE}>One tap, or one tweet.<br />And <Emph delay={0.75}>un-drainable</Emph>.</M>
        <M variants={rise} className="mt-6 font-mono" style={{ ...lead, maxWidth: '64ch' }}>
          Anyone bets Up or Down on Bitcoin in one tap, or just by tweeting, through an agent that can open your position but can never withdraw. Only you can cash out, the vault can never touch it.
        </M>
        <M variants={rise} className="mt-9">
          <div className="flex" style={{ border: `1px solid ${HAIR}`, borderRadius: 12, overflow: 'hidden', background: CARD, maxWidth: 1000 }}>
            {[['One tap', 'Up or Down mints a position in one tx'], ['Tweet-to-bet', 'from a vault only you can withdraw'], ['Google sign-in', 'no seed phrase, never hold SUI']].map(([n, l], i) => (
              <div key={i} className="flex-1" style={{ padding: '18px 22px', borderRight: i < 2 ? `1px solid ${HAIR}` : 'none' }}>
                <div className="font-display font-[700]" style={{ fontSize: 20, letterSpacing: '-0.02em', color: INK }}>{n}</div>
                <div className="mt-1.5 font-mono" style={{ fontSize: 12.5, color: BODY, lineHeight: 1.5 }}>{l}</div>
              </div>
            ))}
          </div>
        </M>
      </div>
    ),
  },

  // 04 · LIVE DEMO / PROOF (centerpiece)
  {
    id: 'demo', section: 'PROOF · TRADE FROM X', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Live: a tweet becomes a position</Kicker>
        <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2rem,5.2vw,4.2rem)' }}>It opened your bet. It took <Emph delay={0.85}>zero</Emph>.</M>
        <M variants={rise} className="font-mono mt-3" style={{ ...lead, maxWidth: '58ch', color: MUTE }}>
          A plain-English tweet opened a real position. Even a perfect prompt injection could only move the money into your own bet. Never out.
        </M>
        <div className="mt-8 grid grid-cols-2 items-stretch" style={{ maxWidth: 860 }}>
          <div className="pr-10" style={{ borderRight: `2px dashed ${VERM}` }}>
            <Mono className="text-[11px]" style={{ color: FAINT }}>RETURNED TO YOU</Mono>
            <div className="font-display font-[800] mt-2" style={{ fontSize: 'clamp(1.8rem,4vw,3rem)', color: INK, letterSpacing: '-0.02em' }}>+<CountUp to={0.953} decimals={3} /> <span style={{ fontSize: '0.5em', color: MUTE }}>DUSDC</span></div>
            <div className="font-mono text-[12px] mt-2" style={{ color: MUTE }}>settled back to your wallet</div>
          </div>
          <div className="pl-10">
            <Mono className="text-[11px]" style={{ color: FAINT }}>TAKEN BY THE AGENT</Mono>
            <div className="font-display font-[800] mt-2" style={{ fontSize: 'clamp(1.8rem,4vw,3rem)', letterSpacing: '-0.02em' }}><Emph delay={0.7}><span style={{ color: GREEN }}>0.00</span></Emph></div>
            <div className="font-mono text-[12px] mt-2" style={{ color: MUTE }}>the vault gives it no withdraw path</div>
          </div>
        </div>
        <M variants={rise} className="mt-8 flex items-center gap-3 flex-wrap">
          <Mono className="text-[11px]" style={{ color: MUTE }}>PROVEN ON-CHAIN · vault624 0x27931b56</Mono>
          <span style={{ color: FAINT }}>·</span>
          <span className="font-mono text-[11px]" style={{ color: VERM }}>close-loop tx BmuJroQS</span>
        </M>
      </div>
    ),
  },

  // 05 · REAL-WORLD DEMAND
  {
    id: 'demand', section: 'REAL-WORLD DEMAND',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Do not trust us, trust the chain</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Real usage, read live<br />from the <Emph delay={0.85}>chain</Emph>.</M>
        <div className="mt-8 flex gap-4" style={{ maxWidth: 1020 }}>
          <StatCard value={<CountUp to={88} />} label="wallets onboarded, gas we sponsored" source="traction.ts · un-fakeable arrivals" />
          <StatCard value={<CountUp to={313} />} label="gas-free on-chain actions, each links to Suiscan" source="sponsor 0xe26c1184" hl />
          <StatCard value="2 in 3" label="arrivals who go on to place a bet" source="first-session activation" />
        </div>
        <M variants={rise} className="mt-7 font-mono" style={{ maxWidth: '84ch', fontSize: 13.5, color: BODY, lineHeight: 1.55 }}>
          Counted live from our own contracts at yosuku.xyz/stats, not self-reported emails. Plus the first TypeScript SDK for DeepBook Predict and an MCP server, with hundreds of npm installs. Web traffic last week, roughly 1,500 views, up about 62% (Vercel, off-chain color).
        </M>
      </div>
    ),
  },

  // 06 · TARGET USERS / PMF
  {
    id: 'users', section: 'TARGET USERS · PMF', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '46%' }}>
          <Kicker>Who it is for</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>Who bets, and<br />why they <Emph delay={0.7}>stay</Emph>.</M>
          <M variants={rise} className="mt-6">
            {['Crypto-curious retail who want plain-language bets', 'People burned by custodial apps that froze them', 'X-native speculators who argue Bitcoin on the timeline', 'Emerging-market users, Nigeria first, funding in local currency', 'AI-agent builders who want programmatic market access'].map((u, i) => (
              <div key={i} className="flex items-baseline gap-3 font-mono" style={{ padding: '7px 0', fontSize: 13.5, color: BODY, lineHeight: 1.4 }}>
                <span style={{ width: 5, height: 5, background: VERM, borderRadius: '50%', flexShrink: 0, transform: 'translateY(-2px)' }} />{u}
              </div>
            ))}
          </M>
        </div>
        <SpecPanel title="WHY THEY ADOPT" badge="ACTIVATION 2 IN 3" w={430} rows={[
          ['Arrive', 'Google, no seed, no SUI'],
          ['First bet', 'One tap or one tweet'],
          ['Trust', 'The agent cannot drain you', true],
          ['Return', 'Winnings waiting to cash out'],
          ['Payout', 'Auto-redeem keeper · tx 32fkHJUz', true],
        ]} />
      </div>
    ),
  },

  // 07 · ARCHITECTURE (custody)
  {
    id: 'arch', section: 'ARCHITECTURE',
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-10">
        <div style={{ maxWidth: '50%' }}>
          <Kicker>How the money stays yours</Kicker>
          <M variants={rise} className={`${H1}`} style={DENSE}>The agent can open.<br />It can never <Emph delay={0.85}>withdraw</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            Every bet settles through a self-owned DeepBook Predict account. The agent key can open a position you own, and there is no withdraw door for it. Custody is enforced in Move, not in a policy we promise to honor.
          </M>
          <M variants={rise} className="mt-6 flex flex-col gap-2">
            {[['1', 'You fund a self-owned account'], ['2', 'Agent opens a position, cannot withdraw'], ['3', 'Settles on the oracle at close'], ['4', 'Keeper redeems, credits you']].map(([n, t], i) => (
              <div key={i} className="flex items-center gap-3 font-mono" style={{ fontSize: 13, color: BODY }}>
                <span className="flex items-center justify-center" style={{ width: 20, height: 20, borderRadius: '50%', border: `1px solid ${HAIR}`, fontSize: 10, color: VERM, flexShrink: 0 }}>{n}</span>{t}
              </div>
            ))}
          </M>
        </div>
        <M variants={rise} className="shrink-0" style={{ transform: 'rotate(1.5deg)' }}>
          <CodeChip />
          <div className="mt-3"><Mono className="text-[10px]" style={{ color: FAINT }}>MOVE · VERIFIABLE · vault624 0x27931b56</Mono></div>
        </M>
      </div>
    ),
  },

  // 08 · THE AGENT (technical, honest about TEE)
  {
    id: 'agent', section: 'THE AGENT', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '48%' }}>
          <Kicker>An agent bounded by consensus</Kicker>
          <M variants={rise} className={`${H1}`} style={DENSE}>Three checks. The hard<br />one is <Emph delay={0.85}>plain code</Emph>.</M>
          <M variants={rise} className="mt-6 flex flex-col gap-3">
            {[['Pre-flight', 'A deterministic guard vetoes, not an LLM'], ['In the enclave', 'The verdict is signed inside the TEE'], ['On-chain', 'Move re-checks the same caps, trustlessly']].map(([n, t], i) => (
              <div key={i} className="flex items-baseline gap-3">
                <Mono className="text-[10px]" style={{ color: VERM, width: 78, flexShrink: 0 }}>{n}</Mono>
                <span className="font-mono" style={{ fontSize: 13.5, color: BODY, lineHeight: 1.4 }}>{t}</span>
              </div>
            ))}
          </M>
        </div>
        <SpecPanel title="ATTESTATION" badge="VERIFIER LIVE" w={430} rows={[
          ['Move verify', 'ed25519 attestation', true],
          ['Package', '0x614a7412'],
          ['Attested trade', 'tx 9zN7JacN'],
          ['Companion', 'Sensei, live'],
          ['Brain today', 'DeepSeek'],
          ['Real Nitro TEE', 'next step', false],
        ]} />
      </div>
    ),
  },

  // 09 · WHY SUI
  {
    id: 'why-sui', section: 'WHY SUI',
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <Kanji className="absolute" style={{ bottom: '-30%', left: '-8%', fontSize: 'clamp(20rem,40vw,48rem)', color: 'rgba(20,18,16,0.04)', lineHeight: 1, zIndex: 0 }} />
        <div className="relative z-10" style={{ maxWidth: '44%' }}>
          <Kicker>Why Sui</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>Built on primitives<br />only <Emph delay={0.7}>Sui</Emph> has.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>This product could not exist on another chain. The venue, the custody guarantee, the attestation, and gasless onboarding are all Sui-native, and all in our shipped code.</M>
        </div>
        <SpecPanel title="THE STACK · IN SHIPPED CODE" badge="ALL NATIVE" w={440} rows={[
          ['Venue', 'DeepBook Predict · 0xdb3ef5a5', true],
          ['Custody', 'No-divert Move vault · 0x27931b56', true],
          ['Attestation', 'Nautilus TEE · 0x614a7412'],
          ['Private content', 'Seal · memory market 0x60189503'],
          ['Storage', 'Walrus · takes 0xeb4d4847'],
          ['Sign-in', 'zkLogin · Google'],
          ['Gas', 'Sponsored · PTB'],
        ]} />
      </div>
    ),
  },

  // 10 · UX
  {
    id: 'ux', section: 'UX', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-10">
        <div style={{ maxWidth: '52%' }}>
          <Kicker>A consumer app</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>A consumer app,<br />not a <Emph delay={0.7}>datasheet</Emph>.</M>
          <M variants={rise} className="mt-6">
            {[['Native iOS app', '24 screens, per-device wallet, Face ID + PIN', 'BUILT'], ['Vertical feed reel', 'live rounds and community takes, TikTok-style', 'BUILT'], ['Daily on-chain streak', 'derived from mint days, un-inflatable', 'BUILT'], ['Honest share cards', 'real-numbers-only, back into X', 'LIVE']].map(([n, d, s], i) => (
              <div key={i} className="flex items-center gap-4" style={{ padding: '11px 0', borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div className="font-display font-[700]" style={{ fontSize: 17, color: INK }}>{n}</div>
                  <div className="font-mono mt-0.5" style={{ fontSize: 12, color: BODY }}>{d}</div>
                </div>
                <Mono className="text-[9.5px]" style={{ color: s === 'LIVE' ? GREEN : MUTE, background: s === 'LIVE' ? 'rgba(46,107,79,0.12)' : 'rgba(20,18,16,0.06)', padding: '3px 9px', borderRadius: 4 }}>{s}</Mono>
              </div>
            ))}
          </M>
        </div>
        <Drop tag="DROP · MOBILE" label="native app, one-tap bet screen" w={230} h={420} tilt={-1.5} />
      </div>
    ),
  },

  // 11 · GO-TO-MARKET
  {
    id: 'gtm', section: 'GO-TO-MARKET',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Distribution built into the product</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>The wedge is a feature.<br />And a <Emph delay={0.85}>channel</Emph>.</M>
        <M variants={rise} className="mt-5 font-mono" style={{ ...lead, maxWidth: '76ch' }}>
          Un-drainable trade-from-X lets you bet where the crowd already argues about Bitcoin, and every bet placed is an ad the next person can tap to copy.
        </M>
        <div className="mt-7 flex gap-4" style={{ maxWidth: 1020 }}>
          <PhaseCard tag="PHASE 0 · NOW" tone="live" title="X betting line" body="Founder posts a card, replies become bets, brand-new tweeters auto-onboard, share cards pull the next person in." />
          <PhaseCard tag="PHASE 1 · NEXT" title="Agents + mobile" body="Publish the MCP so any LLM agent bets through Yosuku, ship the iOS app to TestFlight with streaks and app-lock." />
          <PhaseCard tag="PHASE 2 · THEN" title="Mainnet on-ramp" body="Flip the Paystack Naira on-ramp live so a Nigerian funds in local currency into a self-custodial wallet." />
        </div>
        <M variants={rise} className="mt-6"><Mono className="text-[11px]" style={{ color: MUTE }}>HONEST BOTTLENECK · TOP-OF-FUNNEL DISTRIBUTION, NOT CONVERSION</Mono></M>
      </div>
    ),
  },

  // 12 · MONETIZATION / SUSTAINABILITY
  {
    id: 'money', section: 'MONETIZATION · SUSTAINABILITY', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>How we make money</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Three rails in code.<br />Base bet <Emph delay={0.85}>free</Emph>.</M>
        <M variants={rise} className="mt-7" style={{ maxWidth: 1020 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Revenue rail', 'What it is', 'Status'].map((h, i) => (
                <th key={i} className="font-mono uppercase" style={{ fontSize: 11, letterSpacing: '0.12em', color: INK, fontWeight: 500, padding: '0 16px 9px', textAlign: i === 2 ? 'right' : 'left', borderBottom: `2px solid ${INK}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[
                { line: 'Builder-fee rail', what: 'Native DeepBook rail, attached on-chain, config-flip capped at min(10% fee, 0.5% notional)', status: 'Flips at mainnet', live: false, us: true },
                { line: 'Memory Market', what: 'Seal-gated passes sold in DUSDC (0x60189503)', status: 'Live rail', live: true },
                { line: 'Copy-trade subs', what: 'Follow an attested strategy for a DUSDC fee (0x47d3c108)', status: 'Live rail', live: true, us: true },
                { line: 'Private bets', what: 'Incognito execution premium', status: 'Built', live: false },
              ].map((r, i) => (
                <tr key={i} style={{ background: r.us ? 'rgba(224,77,38,0.04)' : 'transparent' }}>
                  <td style={{ padding: '13px 16px', fontSize: 15.5, color: INK, borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>{r.line}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13.5, color: BODY, borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>{r.what}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>
                    <span className="font-mono uppercase rounded" style={{ fontSize: 10, letterSpacing: '0.08em', padding: '4px 10px', background: r.live ? 'rgba(46,107,79,0.12)' : 'rgba(20,18,16,0.06)', color: r.live ? GREEN : MUTE }}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </M>
        <M variants={rise} className="mt-5 font-mono" style={{ maxWidth: '82ch', fontSize: 13.5, color: BODY, lineHeight: 1.55 }}>
          Pre-revenue by design, not pre-product. Three DUSDC rails already transact. Creators keep 100% today to seed the marketplace, the builder fee is set to zero, and the base bet is always free. Usage compounds into revenue at mainnet without asking anyone to pay to bet.
        </M>
      </div>
    ),
  },

  // 13 · ROADMAP
  {
    id: 'roadmap', section: 'ROADMAP',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Path to production</Kicker>
        <M variants={rise} className={`${H1}`} style={ARTSIZE}>Now. Next. <Emph delay={0.8}>Then</Emph>.</M>
        <div className="mt-8 flex gap-4" style={{ maxWidth: 1020 }}>
          <PhaseCard tag="NOW" tone="live" title="Testnet, live" body="Non-custodial one-tap bets and trade-from-X proven on-chain, gasless onboarding, a keeper that leaves winnings waiting, live /stats." />
          <PhaseCard tag="NEXT" title="Harden + retain" body="Finish the AWS Nitro enclave with production PCRs, ship mobile to TestFlight, wire mobile zkLogin, finish private-bet env." />
          <PhaseCard tag="THEN" title="Mainnet + revenue" body="Flip the builder fee on, take the Naira on-ramp live, grow the marketplaces from seeded to fee-earning, expand MCP and SDK." />
        </div>
        <M variants={rise} className="mt-7 inline-flex items-center gap-3" style={{ borderTop: `2px solid ${GREEN}`, paddingTop: 12, alignSelf: 'flex-start' }}>
          <Mono className="text-[12px]" style={{ color: GREEN }}>EVERY NEXT ITEM MAPS TO A SEAM WE NAMED HONESTLY</Mono>
        </M>
      </div>
    ),
  },

  // 14 · CLOSE / ASK
  {
    id: 'close', section: 'THE ASK', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '56%' }}>
          <Kicker>The ask</Kicker>
          <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2.4rem,6vw,5rem)' }}>Only you can<br /><Emph delay={0.7}>cash out</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            88 wallets and 313 actions live on-chain. Tweet-to-bet proven in tx BmuJroQS. Three revenue rails in code. Built entirely on Sui-native primitives.
          </M>
          <M variants={rise} className="mt-6 font-mono" style={{ fontSize: 15, color: INK, lineHeight: 1.5, maxWidth: '42ch' }}>
            Mainnet is a config flip. We want to take it there with the Sui and DeepBook teams. Verify us live at yosuku.xyz/stats.
          </M>
        </div>
        <M variants={rise} className="absolute overflow-hidden" style={{ right: 0, top: 0, bottom: 0, width: '38%', borderRadius: 14 }}>
          <motion.img src="/pitch/paris.jpg" alt="paid" className="h-full w-full object-cover" style={{ filter: 'sepia(0.15) saturate(0.9)' }}
            initial={{ scale: 1.0 }} animate={{ scale: 1.05 }} transition={{ duration: 9, ease: 'linear' }} />
          <div className="absolute" style={{ inset: 0, background: `linear-gradient(90deg, ${PAPER2} 0%, rgba(244,238,227,0.2) 30%, transparent 60%)` }} />
        </M>
      </div>
    ),
  },
];

function Tick({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const p = { tl: { left: 0, top: 0, transform: 'translate(-50%,-50%)' }, tr: { right: 0, top: 0, transform: 'translate(50%,-50%)' }, bl: { left: 0, bottom: 0, transform: 'translate(-50%,50%)' }, br: { right: 0, bottom: 0, transform: 'translate(50%,50%)' } }[pos];
  return (
    <span className="absolute" style={{ width: 11, height: 11, zIndex: 5, ...p }}>
      <span className="absolute" style={{ left: 5, top: 0, width: 1, height: 11, background: VERM }} />
      <span className="absolute" style={{ top: 5, left: 0, height: 1, width: 11, background: VERM }} />
    </span>
  );
}

export default function PitchDeck() {
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;
  const go = useCallback((d: number) => setIndex((i) => Math.max(0, Math.min(total - 1, i + d))), [total]);
  const goto = useCallback((i: number) => setIndex(Math.max(0, Math.min(total - 1, i))), [total]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') goto(0); else if (e.key === 'End') goto(total - 1);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [go, goto, total]);

  const slide = SLIDES[index];
  const folio = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: slide.paper || PAPER, color: INK, transition: 'background 400ms ease', fontFamily: 'var(--font-sora), ui-sans-serif, system-ui' }}>
      <div className="absolute flex flex-col" style={{ top: '4vh', bottom: '4vh', left: '4.5vw', right: '4.5vw', borderLeft: `1px solid ${HAIR}`, borderRight: `1px solid ${HAIR}`, padding: '0 3vw' }}>
        <Tick pos="tl" /><Tick pos="tr" /><Tick pos="bl" /><Tick pos="br" />

        <div className="flex items-center justify-between shrink-0" style={{ padding: '16px 0 13px', borderBottom: `1px solid ${HAIR}` }}>
          <div className="flex items-center gap-2.5"><Celebrant h={19} /><span className="font-display font-[800]" style={{ fontSize: 15, color: INK, letterSpacing: '-0.01em' }}>yosuku</span></div>
          <Mono className="text-[10.5px]" style={{ color: FAINT }}>[ {folio} ] · {slide.section}</Mono>
        </div>

        <div className="flex-1 flex flex-col justify-center" style={{ minHeight: 0, padding: '10px 0' }}>
          <AnimatePresence mode="wait">
            <M key={slide.id} variants={stagger} initial="hidden" animate="show" exit="exit" className="w-full relative" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {slide.render()}
            </M>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between shrink-0" style={{ padding: '13px 0 15px' }}>
          <Mono className="text-[10px]" style={{ color: FAINT }}>yosuku.xyz</Mono>
          <div className="flex items-center gap-2">
            {SLIDES.map((s, i) => (
              <button key={s.id} onClick={() => goto(i)} aria-label={`slide ${i + 1}`} className="rounded-full transition-all" style={{ height: 5, width: i === index ? 22 : 5, background: i === index ? VERM : 'rgba(20,18,16,0.2)' }} />
            ))}
          </div>
          <Mono className="text-[10px] hidden sm:block" style={{ color: FAINT }}>Built on Sui</Mono>
        </div>
      </div>

      <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 z-30 rounded-full flex items-center justify-center" style={{ width: 40, height: 40, border: `1px solid ${HAIR}`, background: CARD }} aria-label="prev"><ArrowLeft size={17} color={INK} /></button>
      <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 z-30 rounded-full flex items-center justify-center" style={{ width: 40, height: 40, border: `1px solid ${HAIR}`, background: CARD }} aria-label="next"><ArrowRight size={17} color={INK} /></button>
    </div>
  );
}
