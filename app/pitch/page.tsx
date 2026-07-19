'use client';

/* eslint-disable @next/next/no-img-element */
// yosuku.xyz/pitch — "THE YOSUKU FOLIO": the deck as one authored premium issue.
// Warm cream editorial (Yosuku identity) on a construction-frame system. Emphasis is the
// "stub": a ticket-perforation underline that punches in with a vermilion eyelet (the peach
// highlighter is retired). Spec panels + a real revenue table + sourced stats carry substance.
// Nav: ← → space, dots, click.
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

/* ── the "stub": ticket-perforation emphasis (replaces the peach highlighter) ── */
function Emph({ children, delay = 0.55 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-block" style={{ padding: '0 0.05em' }}>
      <span className="relative" style={{ zIndex: 1 }}>{children}</span>
      {/* perforation underline: round ink punches, drawn left → right */}
      <motion.span aria-hidden className="absolute" style={{
        left: 0, right: '0.14em', bottom: '-0.16em', height: 4, zIndex: 0, transformOrigin: 'left',
        backgroundImage: `radial-gradient(circle at center, ${INK} 0 1.4px, transparent 1.7px)`,
        backgroundSize: '8px 4px', backgroundRepeat: 'repeat-x',
      }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay, duration: 0.5, ease: EASE }} />
      {/* vermilion stub-eyelet */}
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

/* ── referrer brand marks (monochrome ink, custom SVG) ── */
const LogoX = ({ s = 12, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 1200 1227" fill={c}><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z" /></svg>;
const LogoGoogle = ({ s = 13, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 48 48" fill={c}>
    <path d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
    <path d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
    <path d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
    <path d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
  </svg>;
const LogoTelegram = ({ s = 13, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" /></svg>;
const LogoCard = ({ s = 22, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s * 0.7} viewBox="0 0 32 22" fill="none"><rect x="1.2" y="1.2" width="29.6" height="19.6" rx="3.2" stroke={c} strokeWidth="2.2" /><rect x="1.2" y="5.6" width="29.6" height="3.6" fill={c} /><rect x="5" y="14" width="9" height="2.6" rx="1.3" fill={c} /></svg>;
const LogoSui = ({ s = 19, c = INK }: { s?: number; c?: string }) =>
  <svg width={s * 0.8} height={s} viewBox="0 0 100 124" fill={c}><path d="M50 6C50 6 14 51 14 81a36 36 0 1 0 72 0C86 51 50 6 50 6Z" /></svg>;
const LogoApple = ({ s = 14, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.88 2.65 3.22 2.6 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.27 3.12-2.53.98-1.45 1.39-2.85 1.41-2.92-.03-.01-2.7-1.04-2.73-4.13ZM14.6 4.87c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44Z" /></svg>;
const LogoWeb = ({ s = 15, c = INK }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" /></svg>;
function PulseDot({ color = GREEN }: { color?: string }) {
  return (
    <span className="relative inline-flex" style={{ width: 8, height: 8 }}>
      <motion.span aria-hidden className="absolute rounded-full" style={{ inset: 0, background: color }}
        animate={{ scale: [1, 2.6], opacity: [0.5, 0] }} transition={{ duration: 1.9, repeat: Infinity, ease: 'easeOut' }} />
      <span className="relative rounded-full" style={{ width: 8, height: 8, background: color }} />
    </span>
  );
}

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

function Barcode({ w = 220, h = 42, color = INK }: { w?: number; h?: number; color?: string }) {
  const seed = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]; let x = 0; let i = 0; const arr: [number, number][] = [];
  while (x < w - 1) { const s = seed[i % seed.length]; const bw = 1 + ((s * 7 + i * 3) % 5); const gap = 2 + ((s + i) % 3); if (x + bw <= w) arr.push([x, bw]); x += bw + gap; i++; }
  return <svg width={w} height={h}>{arr.map(([bx, bw], k) => <rect key={k} x={bx} y={0} width={bw} height={h} fill={color} opacity={0.8} />)}</svg>;
}

function Ticket({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="relative" style={{ width: 320, background: CARD, borderRadius: 18, boxShadow: '0 40px 90px -40px rgba(40,28,18,0.5)', ...style }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: 6, background: VERM, borderRadius: '18px 18px 0 0' }} />
      <div style={{ padding: '24px 24px 20px' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Celebrant h={20} /><span className="font-display font-[800] text-[14px]" style={{ color: INK }}>yosuku</span></div>
          <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1" style={{ background: 'rgba(46,107,79,0.12)' }}>
            <span className="rounded-full" style={{ width: 6, height: 6, background: GREEN }} /><Mono className="text-[9px]" style={{ color: GREEN }}>SETTLED · WON</Mono>
          </span>
        </div>
        <div className="mt-5"><Mono className="text-[10px]" style={{ color: FAINT }}>PAYOUT</Mono>
          <div className="font-display font-[800] leading-none mt-1" style={{ fontSize: 46, color: GREEN, letterSpacing: '-0.03em' }}>+2.93</div>
          <div className="font-mono text-[11px] mt-1.5" style={{ color: MUTE }}>paid to your wallet</div>
        </div>
        <div style={{ height: 1, background: HAIR, margin: '16px 0 12px' }} />
        <Barcode w={272} h={34} />
        <div className="flex justify-between mt-2"><Mono className="text-[9px]" style={{ color: FAINT }}>N° 64000·7FXM</Mono><Mono className="text-[9px]" style={{ color: FAINT }}>SUI TESTNET</Mono></div>
      </div>
    </div>
  );
}

// labeled image placeholder (the founder drops real screenshots later)
function Drop({ label, tag = 'DROP IMAGE', w = 260, h = 300, tilt = 0 }: { label: string; tag?: string; w?: number | string; h?: number; tilt?: number }) {
  return (
    <M variants={rise} className="relative shrink-0 flex flex-col items-center justify-center text-center" style={{ width: w, height: h, transform: `rotate(${tilt}deg)`, border: `1.5px dashed ${HAIR}`, borderRadius: 12, background: SOFT, padding: 24 }}>
      <Mono className="text-[10px]" style={{ color: VERM, letterSpacing: '0.22em' }}>{tag}</Mono>
      <div className="font-mono mt-3" style={{ fontSize: 12, color: MUTE, lineHeight: 1.5, maxWidth: '90%' }}>{label}</div>
    </M>
  );
}

// perforated dotted leader (echoes the ticket stub), used in the ledger + stats
const dots = (color = HAIR): React.CSSProperties => ({ backgroundImage: `radial-gradient(circle at center, ${color} 0 1.3px, transparent 1.6px)`, backgroundSize: '7px 3px', backgroundRepeat: 'repeat-x' });

// our own data presentation: a receipt/ledger stub, not a boxed data panel
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
          <div key={i} className="flex items-baseline" style={{ padding: '10px 0' }}>
            <Mono className="text-[11.5px]" style={{ color: MUTE, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{k}</Mono>
            <span aria-hidden className="flex-1" style={{ height: 3, margin: '0 12px', transform: 'translateY(-3px)', ...dots() }} />
            <span className="font-mono" style={{ fontSize: 14.5, color: hl ? GREEN : INK, whiteSpace: 'nowrap' }}>{v}</span>
          </div>
        ))}
      </div>
    </M>
  );
}

// cover hero facts: bold Sora values, no leaders, readable from the back of a room
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
        <div key={i} className="flex items-center justify-between gap-6" style={{ padding: '13px 0', minHeight: 46, borderBottom: i < rows.length - 1 ? `1px solid ${HAIR}` : 'none' }}>
          <Mono className="text-[10.5px]" style={{ color: FAINT, whiteSpace: 'nowrap' }}>{k}</Mono>
          {typeof v === 'string'
            ? <span className="font-display font-[600] text-right" style={{ fontSize: 21, color: hl ? GREEN : INK, letterSpacing: '-0.015em', lineHeight: 1.1 }}>{v}</span>
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

function ChannelRow({ name, stat, source, point, first }: { name: string; stat: string; source?: string; point: string; first?: boolean }) {
  return (
    <M variants={rise} className="flex items-center gap-6" style={{ padding: '13px 0', borderTop: first ? `1px solid ${HAIR}` : 'none', borderBottom: `1px solid ${HAIR}` }}>
      <div style={{ width: '23%' }}><div className="font-display font-[700]" style={{ fontSize: 20, color: INK, letterSpacing: '-0.01em' }}>{name}</div></div>
      <div style={{ width: '32%' }}>
        <div className="font-mono" style={{ fontSize: 14.5, color: INK, lineHeight: 1.4 }}>{stat}</div>
        {source && <div className="font-mono mt-1" style={{ fontSize: 11, color: MUTE }}>{source}</div>}
      </div>
      <div className="flex-1 font-mono" style={{ fontSize: 14, color: BODY, lineHeight: 1.5 }}>{point}</div>
    </M>
  );
}

function CountUp({ to, decimals = 0, dur = 1.4, prefix = '' }: { to: number; decimals?: number; dur?: number; prefix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => { let raf = 0; let s = 0; const tick = (t: number) => { if (!s) s = t; const p = Math.min(1, (t - s) / (dur * 1000)); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [to, dur]);
  return <>{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

const H1 = 'font-display font-[700] text-[#141210] tracking-[-0.03em] leading-[0.94]';
const ARTSIZE = { fontSize: 'clamp(2.6rem,7.5vw,6.2rem)' };
const DENSE = { fontSize: 'clamp(1.9rem,3.9vw,3.2rem)' };
const lead: React.CSSProperties = { color: BODY, fontSize: 'clamp(14px,1.55vw,17.5px)', lineHeight: 1.55, maxWidth: '44ch' };

/* ── the issue ── */
const SLIDES: { id: string; section: string; paper?: string; render: () => React.ReactNode }[] = [
  {
    id: 'cover', section: 'COVER',
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <div className="relative z-10" style={{ maxWidth: '54%' }}>
          <M variants={rise} className="mb-5"><Celebrant h={44} /></M>
          <M variants={rise}><Mono className="text-[12px]" style={{ color: MUTE }}>予測 · THE YOSUKU FOLIO</Mono></M>
          <M variants={rise} className={`${H1} mt-3`} style={{ fontSize: 'clamp(2.4rem,6.5vw,5.4rem)' }}>
            Only you can<br /><Emph delay={0.7}>cash out</Emph>
          </M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            Yosuku is the consumer Bitcoin prediction market on Sui. Ask a plain-language question, tap Yes or No, and it settles on the oracle. The vault can never touch your money.
          </M>
          <M variants={rise} className="mt-8 flex items-center">
            <span className="flex items-center gap-2.5" style={{ paddingRight: 22 }}>
              <PulseDot /><Mono className="text-[11px]" style={{ color: GREEN }}>LIVE ON TESTNET</Mono>
            </span>
            <span style={{ width: 1, height: 14, background: HAIR }} />
            <span className="flex items-center gap-3" style={{ padding: '0 22px' }}>
              <LogoWeb s={15} /><LogoApple s={15} /><LogoX s={13} />
            </span>
            <span style={{ width: 1, height: 14, background: HAIR }} />
            <span className="flex items-center gap-2" style={{ paddingLeft: 22 }}>
              <LogoSui s={14} /><Mono className="text-[11px]" style={{ color: INK }}>BUILT ON SUI</Mono>
            </span>
          </M>
        </div>
        <Glance rows={[
          ['Category', 'Bitcoin prediction market'],
          ['Engine', 'DeepBook Predict', true],
          ['Custody', 'Non-custodial', true],
          ['Onboarding', (
            <span className="flex items-center gap-3">
              <LogoGoogle s={20} /><span style={{ color: FAINT }}>·</span><LogoCard s={25} /><span style={{ color: FAINT }}>·</span><LogoX s={16} />
            </span>
          )],
          ['Built on', (
            <span className="flex items-center gap-2.5">
              <LogoSui s={21} /><span className="font-display font-[600]" style={{ fontSize: 21, color: INK, letterSpacing: '-0.015em' }}>Sui</span>
            </span>
          )],
        ]} />
      </div>
    ),
  },
  {
    id: 'problem', section: 'PROBLEM', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '52%' }}>
          <Kicker>The wound</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>They froze<br />your money.</M>
          <M variants={rise} className="mt-6 font-mono" style={{ ...lead, letterSpacing: '0.02em' }}>
            Every betting app holds your balance and decides if you won. You are not a customer. You are a mark.
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
  {
    id: 'solution', section: 'SOLUTION',
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-10">
        <div style={{ maxWidth: '54%' }}>
          <Kicker>The answer, as code</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>We can never<br /><Emph delay={0.7}>touch it</Emph></M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>The vault only ever pays the owner. Not a promise in the pitch, a rule in the contract.</M>
        </div>
        <M variants={rise} className="shrink-0" style={{ transform: 'rotate(1.5deg)' }}>
          <div style={{ width: 360, background: '#17140F', borderRadius: 14, boxShadow: '0 40px 90px -44px rgba(40,28,18,0.6)', overflow: 'hidden' }}>
            <div className="flex items-center gap-1.5 px-4" style={{ height: 32, background: 'rgba(255,255,255,0.04)' }}>
              <span className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.14)' }} /><span className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.14)' }} /><span className="rounded-full" style={{ width: 8, height: 8, background: VERM }} />
              <Mono className="text-[9px] ml-2" style={{ color: 'rgba(255,255,255,0.4)' }}>no_divert_vault.move</Mono>
            </div>
            <div className="p-5 font-mono text-[12.5px]" style={{ color: '#E8E2D4', lineHeight: 1.7 }}>
              <div><span style={{ color: '#C05CD8' }}>public fun</span> <span style={{ color: '#5B8DEF' }}>agent_trade</span>(...) {'{'}</div>
              <div className="pl-4" style={{ color: 'rgba(255,255,255,0.5)' }}>// payout can only ever</div>
              <div className="pl-4" style={{ color: 'rgba(255,255,255,0.5)' }}>// return to the owner</div>
              <div className="pl-4"><span style={{ color: '#2FA47C' }}>transfer</span>(win, <span style={{ color: VERM }}>owner</span>);</div>
              <div>{'}'}</div>
            </div>
          </div>
          <div className="mt-3"><Mono className="text-[10px]" style={{ color: FAINT }}>CUSTODY IS CODE · VERIFIABLE ON-CHAIN</Mono></div>
        </M>
      </div>
    ),
  },
  {
    id: 'product', section: 'PRODUCT', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <div className="flex items-center justify-between gap-10">
          <div style={{ maxWidth: '52%' }}>
            <Kicker>The product</Kicker>
            <M variants={rise} className={`${H1}`} style={ARTSIZE}>One tap.<br />You are <Emph delay={0.7}>in</Emph></M>
            <M variants={rise} className="mt-6 font-mono" style={lead}>Ask a plain-language question. Tap Yes or No. Getting your first bet down is a card tap, not a crypto exchange detour.</M>
          </div>
          <M variants={rise} className="shrink-0" style={{ transform: 'rotate(-2deg)' }}><Ticket /></M>
        </div>
        <M variants={rise} className="mt-9">
          <div className="flex" style={{ border: `1px solid ${HAIR}`, borderRadius: 12, overflow: 'hidden', background: CARD, maxWidth: 940 }}>
            {[['Card or bank', 'Paystack · test mode'], ['Sign in with Google', 'zkLogin, no seed phrase'], ['Gas on us', 'sponsored every bet']].map(([n, l], i) => (
              <div key={i} className="flex-1" style={{ padding: '18px 22px', borderRight: i < 2 ? `1px solid ${HAIR}` : 'none' }}>
                <div className="font-display font-[700]" style={{ fontSize: 19, letterSpacing: '-0.02em', color: INK }}>{n}</div>
                <div className="mt-2"><Mono className="text-[11.5px]" style={{ color: MUTE }}>{l}</Mono></div>
              </div>
            ))}
          </div>
        </M>
      </div>
    ),
  },
  {
    id: 'proof', section: 'PROOF · THE CENTERPIECE',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>On-chain proof of custody</Kicker>
        <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2.2rem,5.5vw,4.6rem)' }}>It moved your money.</M>
        <M variants={rise} className="font-display font-[500] mt-1" style={{ fontSize: 'clamp(1.4rem,3.4vw,2.6rem)', color: MUTE, letterSpacing: '-0.02em' }}>
          Its own balance moved <span className="font-[800]" style={{ color: GREEN }}>0.00</span>
        </M>
        <div className="mt-9 grid grid-cols-2 items-stretch" style={{ maxWidth: 860 }}>
          <div className="pr-10" style={{ borderRight: `2px dashed ${VERM}` }}>
            <Mono className="text-[11px]" style={{ color: FAINT }}>YOUR ACCOUNT</Mono>
            <div className="font-display font-[800] mt-2" style={{ fontSize: 'clamp(1.8rem,4vw,3rem)', color: INK, letterSpacing: '-0.02em' }}>+<CountUp to={2.93} decimals={2} /> <span style={{ fontSize: '0.5em', color: MUTE }}>DUSDC</span></div>
            <div className="font-mono text-[12px] mt-2" style={{ color: MUTE }}>position opened, credited to you</div>
          </div>
          <div className="pl-10">
            <Mono className="text-[11px]" style={{ color: FAINT }}>THE AGENT</Mono>
            <div className="font-display font-[800] mt-2" style={{ fontSize: 'clamp(1.8rem,4vw,3rem)', letterSpacing: '-0.02em' }}><Emph delay={0.7}><span style={{ color: GREEN }}>0.00</span></Emph></div>
            <div className="font-mono text-[12px] mt-2" style={{ color: MUTE }}>the contract gives it no way to divert</div>
          </div>
        </div>
        <M variants={rise} className="mt-8 flex items-center gap-3 flex-wrap">
          <Mono className="text-[11px]" style={{ color: MUTE }}>MOVE CODE · VERIFIABLE ON-CHAIN</Mono>
          <span style={{ color: FAINT }}>·</span>
          <span className="font-mono text-[11px]" style={{ color: VERM }}>tx 9zN7JacN…</span>
        </M>
      </div>
    ),
  },
  {
    id: 'why-sui', section: 'WHY SUI', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <Kanji className="absolute" style={{ bottom: '-30%', left: '-8%', fontSize: 'clamp(20rem,40vw,48rem)', color: 'rgba(20,18,16,0.04)', lineHeight: 1, zIndex: 0 }} />
        <div className="relative z-10" style={{ maxWidth: '46%' }}>
          <Kicker>Technical implementation</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>Only possible<br />on <Emph delay={0.7}>Sui</Emph></M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>Every layer that makes cannot-touch-it real is native to the chain, not bolted on.</M>
        </div>
        <SpecPanel title="THE STACK" badge="ALL SHIPPED" w={420} rows={[
          ['Engine', 'DeepBook Predict', true],
          ['Onboarding', 'zkLogin · Google sign-in'],
          ['Fees', 'Sponsored gas'],
          ['Bet', 'One-signature PTB'],
          ['Custody', 'No-divert Move vault', true],
          ['Agent feed', 'Walrus'],
          ['Memory', 'Seal-encrypted'],
        ]} />
      </div>
    ),
  },
  {
    id: 'market', section: 'MARKET', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>The market</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>The crowd is <Emph delay={0.85}>already here</Emph></M>
        <div className="mt-8 flex gap-4" style={{ maxWidth: 1020 }}>
          <StatCard value="$50B+" label="prediction-market volume, World Cup opening month" source="CoinDesk · Jul 2026" />
          <StatCard value="$23.8B" label="Kalshi 2025 volume, up 1,108% year on year" source="KalshiData · FY2025" hl />
          <StatCard value="$9B / 314K" label="Polymarket 2024 volume / active traders" source="The Block · Jan 2025" />
        </div>
        <M variants={rise} className="mt-7 font-mono" style={{ ...lead, maxWidth: '80ch', fontSize: 14, color: MUTE }}>
          The demand is proven. Volume is lumpy and event-driven, it fell after the 2024 US election before rebuilding. Revenue is young: Kalshi charges per-contract fees, Polymarket only switched on trading fees in March 2026. What is missing is a version the crowd cannot be locked out of.
        </M>
      </div>
    ),
  },
  {
    id: 'traction', section: 'TRACTION',
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '44%' }}>
          <Kicker>Do not trust us, trust data</Kicker>
          <M variants={rise} className={`${H1}`} style={DENSE}>They show up.<br />Then they <Emph delay={0.85}>bet</Emph></M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>Traffic is climbing and it converts. Two in three strangers who land actually place a bet, and every wallet was ours to onboard, gas paid.</M>
          <M variants={rise} className="mt-6 flex gap-2.5 flex-wrap">
            <Pill icon={<LogoX />}>X</Pill><Pill icon={<LogoGoogle />}>Google</Pill><Pill icon={<LogoTelegram />}>Telegram</Pill>
          </M>
        </div>
        <div className="flex flex-col gap-8 shrink-0">
          <SpecPanel title="DEMAND · LAST 7 DAYS" badge="↑ GROWING" w={430} rows={[
            ['Page views', <span key="pv">1,459 <span style={{ color: GREEN }}>+62%</span></span>, false],
            ['Visitors', <span key="v">209 <span style={{ color: GREEN }}>+27%</span></span>, false],
            ['Bounce rate', '33%'],
            ['Top page', '/markets'],
          ]} />
          <SpecPanel title="ON-CHAIN · TO DATE" badge="ON SUI" w={430} rows={[
            ['Wallets onboarded', '98 · gas ours', true],
            ['Gas-free actions', '379'],
            ['Arrive → bet', '2 in 3', true],
          ]} />
        </div>
      </div>
    ),
  },
  {
    id: 'fresh', section: 'LAST 24 HOURS', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Live external validation</Kicker>
        <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(1.9rem,5vw,4.2rem)' }}>
          &ldquo;dope.&rdquo; Then three<br />strangers <Emph delay={0.7}>won</Emph>
        </M>
        <div className="mt-7 flex items-stretch gap-6">
          <Drop tag="DROP · 01" label="@aslan_web3 'wait this is dope' reply on X" w={230} h={300} tilt={-2} />
          <Drop tag="DROP · 02" label="three winning receipts, settled on-chain" w={230} h={300} tilt={2} />
          <M variants={rise} className="font-mono flex items-center" style={{ ...lead, maxWidth: '22ch' }}>
            A DeepBook contributor called it dope. Minutes later, three people bet from an X reply and won, live, with receipts in the thread.
          </M>
        </div>
      </div>
    ),
  },
  {
    id: 'distribution', section: 'GO-TO-MARKET',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Distribution</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Meet the crowd where<br />they <Emph delay={0.85}>already are</Emph></M>
        <M variants={rise} className="mt-7" style={{ maxWidth: 1080 }}>
          <ChannelRow first name="Bet from X" stat="~561M monthly actives" source="indep. estimate · 2025" point="A one-tap Yes or No inside a reply, un-drainable, so every bet placed is a visible ad others can tap to copy." />
          <ChannelRow name="MCP server" stat="10,000+ MCP servers · 97M+ SDK dl/mo" source="Anthropic · Dec 2025" point="Agent-ready before the wave lands. An agent can place a bet, and non-custody means it can never drain the vault." />
          <ChannelRow name="Native mobile" stat="~142B app downloads in 2025" source="Statista / Business of Apps · 2025" point="A second top-of-funnel in the store, where roughly 80% of US wagers already happen on a phone." />
          <ChannelRow name="Paystack on-ramp" stat="200,000+ merchants · test mode" source="Paystack · matches testnet" point="Onboard with a familiar card or bank payment instead of a crypto exchange detour." />
        </M>
      </div>
    ),
  },
  {
    id: 'business', section: 'BUSINESS MODEL',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>How we make money</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Base bets stay free.<br />We earn on the <Emph delay={0.85}>edges</Emph></M>
        <M variants={rise} className="mt-7" style={{ maxWidth: 1000 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Revenue line', 'What it is', 'Status'].map((h, i) => (
                <th key={i} className="font-mono uppercase" style={{ fontSize: 11.5, letterSpacing: '0.12em', color: INK, fontWeight: 500, padding: '0 18px 9px', background: 'transparent', textAlign: i === 2 ? 'right' : 'left', borderBottom: `2px solid ${INK}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[
                { line: 'Builder-fee rail', what: 'Native DeepBook rail, registered on-chain, wired at 0', status: 'Flips at mainnet', live: false, us: true },
                { line: 'Memory-pass market', what: 'Seal-gated memories sold as priced on-chain assets', status: 'Live', live: true },
                { line: 'Copy-trade subscriptions', what: 'Follow an attested agent strategy for a fee', status: 'Live', live: true, us: true },
                { line: 'Private bets', what: 'Incognito execution for a small premium', status: 'Live', live: true },
              ].map((r, i) => (
                <tr key={i} style={{ background: r.us ? 'rgba(224,77,38,0.04)' : 'transparent' }}>
                  <td style={{ padding: '14px 18px', fontSize: 16.5, color: INK, borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>{r.line}</td>
                  <td style={{ padding: '14px 18px', fontSize: 14.5, color: BODY, borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>{r.what}</td>
                  <td style={{ padding: '13px 18px', textAlign: 'right', borderBottom: i < 3 ? `1px solid ${HAIR}` : 'none' }}>
                    <span className="font-mono uppercase rounded" style={{ fontSize: 10.5, letterSpacing: '0.08em', padding: '4px 10px', background: r.live ? 'rgba(46,107,79,0.12)' : 'rgba(20,18,16,0.06)', color: r.live ? GREEN : MUTE }}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </M>
        <M variants={rise} className="mt-5 font-mono" style={{ ...lead, maxWidth: '74ch' }}>
          Revenue is already flowing from memory passes and copy-trade subscriptions. The builder-fee rail is registered on DeepBook and set to zero, one config flip away from live the day the protocol opens it.
        </M>
      </div>
    ),
  },
  {
    id: 'roadmap', section: 'ROADMAP', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Where it goes</Kicker>
        <M variants={rise} className={`${H1}`} style={ARTSIZE}>Advises today.<br /><Emph delay={0.75}>Trades tomorrow</Emph></M>
        <div className="mt-8 flex gap-4" style={{ maxWidth: 980 }}>
          {[['Now', 'One-tap bets, trade-from-X, native mobile, attested agent advice. Live on testnet.'], ['Next', 'Sensei graduates from advising to executing, under the same vault that can never take your money.'], ['Then', 'Mainnet, one config flip away. The builder-fee rail switches on.']].map(([t, d], i) => (
            <M key={i} variants={rise} className="flex-1" style={{ background: CARD, border: `1px solid ${HAIR}`, borderLeft: `3px solid ${i === 0 ? GREEN : INK}`, borderRadius: 8, padding: '18px 20px' }}>
              <div className="font-display font-[700]" style={{ fontSize: 20, color: INK }}>{t}</div>
              <div className="mt-2 font-mono" style={{ fontSize: 12, color: MUTE, lineHeight: 1.5 }}>{d}</div>
            </M>
          ))}
        </div>
        <M variants={rise} className="mt-7 inline-flex items-center gap-3" style={{ borderTop: `2px solid ${GREEN}`, paddingTop: 12, alignSelf: 'flex-start' }}>
          <Mono className="text-[12px]" style={{ color: GREEN }}>IT STILL CANNOT TAKE IT</Mono>
        </M>
      </div>
    ),
  },
  {
    id: 'team', section: 'THE TEAM',
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '48%' }}>
          <Kicker>The team</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>One builder.<br />The whole <Emph delay={0.7}>stack</Emph></M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>Move contracts, an attested TEE agent, a native iOS app, the 24/7 X relay, and the web app. Product, protocol and design, shipped solo.</M>
          <M variants={rise} className="mt-5 font-mono" style={{ fontSize: 15, color: INK, lineHeight: 1.5, maxWidth: '42ch' }}>If one person can ship this much, imagine the pace with a team.</M>
        </div>
        <SpecPanel title="SHIPPED SOLO · ON SUI" badge="IN PRODUCTION" w={420} rows={[
          ['Contracts', 'Move · Sui testnet', true],
          ['Agent', 'Nautilus TEE · attested'],
          ['Onboarding', 'zkLogin · sponsored gas'],
          ['Apps', 'Native iOS + web'],
          ['Distribution', 'Trade-from-X relay'],
        ]} />
      </div>
    ),
  },
  {
    id: 'close', section: 'THE ASK', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '54%' }}>
          <Kicker>The ask</Kicker>
          <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2.4rem,6vw,5rem)' }}>Mainnet is <Emph delay={0.7}>one flip away</Emph>.<br />Take it there.</M>
          <M variants={rise} className="mt-7"><Mono className="text-[12px]" style={{ color: MUTE }}>WITH THE SUI AND DEEPBOOK TEAMS · yosuku.xyz</Mono></M>
        </div>
        <M variants={rise} className="absolute overflow-hidden" style={{ right: 0, top: 0, bottom: 0, width: '40%', borderRadius: 14 }}>
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
