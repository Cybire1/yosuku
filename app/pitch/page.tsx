'use client';

/* eslint-disable @next/next/no-img-element */
// yosuku.xyz/pitch — "THE YOSUKU FOLIO". Narrative: DeepBook Predict is the engine that already
// redefined prediction markets; Yosuku is the experience + distribution layer that brings it to
// where people already are (X, a card, a phone, AI agents), non-custodial so it is safe everywhere.
// Grounded in the real codebase. Nav: ← → space, dots, click.
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
  return <M variants={rise} className="inline-flex items-center gap-2 font-mono uppercase" style={{ fontSize: 12, letterSpacing: '0.2em', color: MUTE, marginBottom: 16 }}>
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
  <svg width={s * 0.82} height={s} viewBox="0 0 128 160" fill={c}><path fillRule="evenodd" clipRule="evenodd" d="M64 13c14.4 20.3 46.3 68.2 46.3 99.4 0 25.6-20.7 46.3-46.3 46.3S17.7 138 17.7 112.4C17.7 81.2 49.6 33.3 64 13Zm0 26.6C52.6 56.2 33.1 87.9 33.1 108.6c0 17 13.8 30.9 30.9 30.9s30.9-13.8 30.9-30.9C94.9 87.9 75.4 56.2 64 39.6Z" /></svg>;
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

/* ── product mockups (rich, on-brand, for the side visuals) ── */
const SORA = 'var(--font-sora), ui-sans-serif, system-ui';
const MONO = 'var(--font-mono), ui-monospace, monospace';

function MiniChart({ w = 236, h = 82, strikeY = 46 }: { w?: number; h?: number; strikeY?: number }) {
  const raw = [[0, 70], [26, 60], [52, 64], [78, 48], [104, 52], [130, 40], [156, 44], [182, 30], [w, 20]];
  const pts = raw.map(([x, y]) => [x / 236 * w, y]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1]}`).join(' ');
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h}>
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E6B4F" stopOpacity="0.32" /><stop offset="1" stopColor="#2E6B4F" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#cg)" />
      <line x1="0" y1={strikeY} x2={w} y2={strikeY} stroke="#E04D26" strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
      <path d={d} fill="none" stroke="#4FB985" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="#4FB985" />
    </svg>
  );
}
const LockIcon = ({ s = 16, c = '#E88' }: { s?: number; c?: string }) =>
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;

// realistic dark Yosuku phone screen (bet or won)
function PhoneMock({ tilt = 0, won = false }: { tilt?: number; won?: boolean }) {
  return (
    <M variants={rise} style={{ width: 284, transform: `rotate(${tilt}deg)` }}>
      <div style={{ background: '#0D0B09', borderRadius: 42, padding: 11, boxShadow: '0 55px 120px -40px rgba(40,28,18,0.62)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ background: '#16120E', borderRadius: 32, overflow: 'hidden', paddingBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 22px 2px', color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: MONO }}><span>9:41</span><span>◗ ▮</span></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Celebrant h={17} /><span style={{ color: '#F1EADC', fontWeight: 800, fontSize: 15, fontFamily: SORA }}>yosuku</span></div>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: MONO }}>$12.74</span>
          </div>
          {won ? (
            <div style={{ padding: '18px 16px 20px', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(46,107,79,0.18)', border: '1px solid rgba(79,185,133,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '10px auto 0' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4FB985" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></div>
              <div style={{ color: '#4FB985', fontSize: 12, fontFamily: MONO, letterSpacing: '0.12em', marginTop: 14 }}>SETTLED · WON</div>
              <div style={{ color: '#F1EADC', fontSize: 40, fontWeight: 800, fontFamily: SORA, letterSpacing: '-0.03em', marginTop: 4 }}>+$14.60</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: MONO, marginTop: 6 }}>paid to your wallet</div>
              <div style={{ margin: '18px 14px 0', background: '#E04D26', borderRadius: 12, padding: '13px 0', color: '#fff', fontWeight: 700, fontFamily: SORA, fontSize: 14 }}>Cash out</div>
            </div>
          ) : (
            <>
              <div style={{ margin: '6px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 18, padding: 15 }}>
                <div style={{ color: '#F1EADC', fontSize: 13.5, fontWeight: 600, fontFamily: SORA, lineHeight: 1.3 }}>Will BTC close above $64,000?</div>
                <div style={{ marginTop: 10 }}><MiniChart w={236} h={80} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, fontFamily: MONO }}><span style={{ color: '#4FB985' }}>BTC $64,180 ↑</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>settles 04:12</span></div>
              </div>
              <div style={{ display: 'flex', gap: 9, padding: '4px 14px' }}>
                <div style={{ flex: 1, background: 'rgba(46,107,79,0.16)', border: '1px solid rgba(79,185,133,0.45)', borderRadius: 12, padding: '11px 0', textAlign: 'center', color: '#4FB985', fontFamily: MONO, fontSize: 12.5 }}>▲ UP</div>
                <div style={{ flex: 1, background: 'rgba(224,77,38,0.12)', border: '1px solid rgba(224,77,38,0.4)', borderRadius: 12, padding: '11px 0', textAlign: 'center', color: '#E88', fontFamily: MONO, fontSize: 12.5 }}>▼ DOWN</div>
              </div>
              <div style={{ padding: '8px 14px 16px' }}>
                <div style={{ background: '#E04D26', borderRadius: 12, padding: '13px 0', textAlign: 'center', color: '#fff', fontWeight: 700, fontFamily: SORA, fontSize: 14 }}>Place bet · $5.00</div>
              </div>
            </>
          )}
        </div>
      </div>
    </M>
  );
}

// X post + reply-to-bet card
function XBetCard({ tilt = 0 }: { tilt?: number }) {
  return (
    <M variants={rise} style={{ width: 356, transform: `rotate(${tilt}deg)`, background: '#000', borderRadius: 18, boxShadow: '0 46px 105px -40px rgba(40,28,18,0.55)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', color: '#E7E9EA' }}>
      <div style={{ padding: '16px 18px 14px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#F1EADC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Celebrant h={20} /></div>
          <div><div style={{ fontWeight: 700, fontSize: 14, fontFamily: SORA }}>Yosuku</div><div style={{ color: '#71767B', fontSize: 12, fontFamily: MONO }}>@yosukuapp</div></div>
          <span style={{ marginLeft: 'auto', color: '#71767B', fontSize: 16 }}><LogoX s={15} c="#71767B" /></span>
        </div>
        <div style={{ marginTop: 11, fontSize: 14.5, fontFamily: SORA, lineHeight: 1.35 }}>Will BTC close above $64,000 by 23:40 UTC?</div>
        <div style={{ marginTop: 11, background: '#16120E', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#F1EADC', fontSize: 11.5, fontFamily: MONO }}><span>YOSUKU · BTC $64,000</span><span style={{ color: '#4FB985' }}>↑ 0.4%</span></div>
          <div style={{ marginTop: 8 }}><MiniChart w={296} h={58} strikeY={34} /></div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '14px 18px', display: 'flex', gap: 11 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3a3a44,#22232a)', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13.5, fontFamily: SORA }}><span style={{ color: '#1D9BF0' }}>@yosukuapp</span> BTC up, $5</div>
          <div style={{ marginTop: 9, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(46,107,79,0.15)', border: '1px solid rgba(79,185,133,0.4)', borderRadius: 10, padding: '8px 12px', fontSize: 11.5, fontFamily: MONO, color: '#4FB985' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4FB985' }} />POSITION OPENED · tx BmuJroQS</div>
        </div>
      </div>
    </M>
  );
}

// custodial-app-frozen phone (the problem)
function FrozenPhone({ tilt = 4 }: { tilt?: number }) {
  return (
    <M variants={rise} style={{ width: 258, transform: `rotate(${tilt}deg)` }}>
      <div style={{ background: '#191a1d', borderRadius: 38, padding: 10, boxShadow: '0 46px 105px -44px rgba(20,18,16,0.5)', filter: 'saturate(0.65)' }}>
        <div style={{ background: '#232428', borderRadius: 30, padding: '24px 20px', minHeight: 372, display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: MONO, letterSpacing: '0.1em' }}>YOUR BALANCE</div>
          <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 34, fontWeight: 800, fontFamily: SORA, letterSpacing: '-0.02em', marginTop: 5 }}>$1,240.00</div>
          <div style={{ marginTop: 26, background: 'rgba(224,77,38,0.12)', border: '1px solid rgba(224,77,38,0.4)', borderRadius: 12, padding: 15, display: 'flex', alignItems: 'center', gap: 11 }}>
            <LockIcon s={17} /><div style={{ color: '#E88', fontSize: 12.5, fontFamily: MONO }}>Withdrawals disabled</div>
          </div>
          <div style={{ marginTop: 14, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.05)' }} />
          <div style={{ marginTop: 'auto', color: 'rgba(255,255,255,0.28)', fontSize: 10, fontFamily: MONO, textAlign: 'center', letterSpacing: '0.1em' }}>A CUSTODIAL APP</div>
        </div>
      </div>
    </M>
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
          <div key={i} className="flex items-baseline" style={{ padding: '10px 0' }}>
            <Mono className="text-[12.5px]" style={{ color: MUTE, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{k}</Mono>
            <span aria-hidden className="flex-1" style={{ height: 3, margin: '0 12px', transform: 'translateY(-3px)', ...dots() }} />
            <span className="font-mono" style={{ fontSize: 15, color: hl ? GREEN : INK, whiteSpace: 'nowrap' }}>{v}</span>
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
          <Mono className="text-[11.5px]" style={{ color: FAINT, whiteSpace: 'nowrap' }}>{k}</Mono>
          {typeof v === 'string'
            ? <span className="font-display font-[600] text-right" style={{ fontSize: 22, color: hl ? GREEN : INK, letterSpacing: '-0.015em', lineHeight: 1.1 }}>{v}</span>
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
      <div className="font-mono uppercase" style={{ fontSize: 13.5, letterSpacing: '0.09em', color: BODY, lineHeight: 1.5 }}>{label}</div>
      {source && <div className="mt-2.5 font-mono" style={{ fontSize: 12, color: MUTE, letterSpacing: '0.04em' }}>{source}</div>}
    </M>
  );
}

// now/next/then + phase cards
function PhaseCard({ tag, title, body, tone = 'ink' }: { tag: string; title: string; body: string; tone?: 'ink' | 'live' }) {
  return (
    <M variants={rise} className="flex-1" style={{ background: CARD, border: `1px solid ${HAIR}`, borderLeft: `3px solid ${tone === 'live' ? GREEN : INK}`, borderRadius: 8, padding: '18px 20px' }}>
      <Mono className="text-[10px]" style={{ color: tone === 'live' ? GREEN : VERM }}>{tag}</Mono>
      <div className="font-display font-[700] mt-2" style={{ fontSize: 21, color: INK, letterSpacing: '-0.01em' }}>{title}</div>
      <div className="mt-2 font-mono" style={{ fontSize: 14, color: BODY, lineHeight: 1.5 }}>{body}</div>
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
const lead: React.CSSProperties = { color: BODY, fontSize: 'clamp(15.5px,1.85vw,20px)', lineHeight: 1.6, maxWidth: '44ch' };

/* ── the issue: DeepBook is the engine, Yosuku is the experience ── */
const SLIDES: { id: string; section: string; paper?: string; render: () => React.ReactNode }[] = [
  // 01 · COVER (at a glance)
  {
    id: 'glance', section: 'COVER',
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <div className="relative z-10" style={{ maxWidth: '52%' }}>
          <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2rem,5.3vw,4.5rem)' }}>
            The whole<br />timeline is <Emph delay={0.7}>Vegas</Emph>.
          </M>
          <M variants={rise} className="mt-6 font-mono" style={{ ...lead, maxWidth: '50ch' }}>
            Bet on whether Bitcoin goes up or down. From the web, your phone, an X reply, or an AI agent. It settles on the oracle, and only you can cash out, the vault can never touch it. Built on DeepBook Predict, on Sui. <span style={{ color: INK }}>Live on testnet.</span>
          </M>
          <M variants={rise} className="mt-7 flex gap-2.5 flex-wrap">
            <Pill tone="live">Live on testnet</Pill><Pill>Web · iOS · X</Pill><Pill tone="verm">Built on Sui</Pill>
          </M>
        </div>
        <Glance rows={[
          ['You bet on', 'Bitcoin, up or down'],
          ['Where', 'Web · mobile · X · agents'],
          ['Engine', 'DeepBook Predict', true],
          ['Custody', 'Non-custodial', true],
          ['Onboarding', (<span className="flex items-center gap-3"><LogoGoogle s={19} /><span style={{ color: FAINT }}>·</span><LogoCard s={24} /></span>)],
          ['Built on', (<span className="flex items-center gap-2.5"><LogoSui s={20} /><span className="font-display font-[600]" style={{ fontSize: 22, color: INK, letterSpacing: '-0.015em' }}>Sui</span></span>)],
        ]} />
      </div>
    ),
  },

  // 02 · THE ENGINE (DeepBook did the hard part)
  {
    id: 'engine', section: 'THE ENGINE', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '48%' }}>
          <Kicker>DeepBook did the hard part</Kicker>
          <M variants={rise} className={`${H1}`} style={DENSE}>We reinvented<br />the way <Emph delay={0.85}>in</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            DeepBook Predict already redefined the prediction market: real leverage, range and strike orders, instant settlement, and no committee deciding who won. The mechanism is solved. Our job is the experience.
          </M>
        </div>
        <SpecPanel title="DEEPBOOK PREDICT · THE ENGINE" badge="ON SUI" w={430} rows={[
          ['Positions', 'Up, Down, range, strike'],
          ['Leverage', 'Native, on-chain', true],
          ['Settlement', 'Instant, at close'],
          ['Who decides', 'The oracle, no committee', true],
          ['Accounts', 'Object-owned, self-custody'],
        ]} />
      </div>
    ),
  },

  // 03 · THE GAP (problem, UX-framed)
  {
    id: 'gap', section: 'THE GAP',
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '54%' }}>
          <Kicker>Powerful, but locked away</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>A great market<br />no one can <Emph delay={0.7}>reach</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            To use it you need a wallet, a gas token, and to read an order book. And the apps that make it easy hold your balance, so they can freeze you, or be prompt-injected into draining you. The best prediction market on-chain stays out of reach of normal people.
          </M>
        </div>
        <div className="absolute" style={{ right: '2%', top: '50%', transform: 'translateY(-50%)' }}>
          <FrozenPhone tilt={4} />
        </div>
      </div>
    ),
  },

  // 04 · OUR EDGE (value prop = experience)
  {
    id: 'edge', section: 'OUR EDGE', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Same market, better experience</Kicker>
        <M variants={rise} className={`${H1}`} style={ARTSIZE}>The winner wins on<br /><Emph delay={0.85}>experience</Emph>.</M>
        <M variants={rise} className="mt-6 font-mono" style={{ ...lead, maxWidth: '66ch' }}>
          TikTok, WhatsApp, Instagram, all the same category. Experience decides who wins. Yosuku brings the prediction market to the front of your users: a tap, a tweet, a card, an agent. Non-custodial, so it is safe to be everywhere.
        </M>
        <M variants={rise} className="mt-9">
          <div className="flex" style={{ border: `1px solid ${HAIR}`, borderRadius: 12, overflow: 'hidden', background: CARD, maxWidth: 1000 }}>
            {[['Bet from a tweet', 'reply or tag @yosukuapp'], ['Fund with a card', 'never touch crypto'], ['On your phone', 'native app + web'], ['Through an agent', 'MCP, un-drainable']].map(([n, l], i) => (
              <div key={i} className="flex-1" style={{ padding: '18px 20px', borderRight: i < 3 ? `1px solid ${HAIR}` : 'none' }}>
                <div className="font-display font-[700]" style={{ fontSize: 18, letterSpacing: '-0.02em', color: INK }}>{n}</div>
                <div className="mt-1.5 font-mono" style={{ fontSize: 12, color: BODY, lineHeight: 1.5 }}>{l}</div>
              </div>
            ))}
          </div>
        </M>
      </div>
    ),
  },

  // 05 · X AS VEGAS (distribution wedge)
  {
    id: 'x', section: 'DISTRIBUTION · X',
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-10">
        <div style={{ maxWidth: '52%' }}>
          <Kicker>Where the crowd already is</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>X is Vegas.<br />So we bet <Emph delay={0.7}>there</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            A user called X Vegas. Prediction markets on X will be wild. Reply to a market post or tag @yosukuapp and your bet is placed. It is un-drainable, so a bot near your money is safe, and every bet is an ad the next person can tap to copy.
          </M>
          <M variants={rise} className="mt-6 flex gap-2.5 flex-wrap">
            <Pill tone="live">Live 24/7</Pill><Pill>Un-drainable</Pill><Pill>No install</Pill>
          </M>
        </div>
        <XBetCard tilt={-1.5} />
      </div>
    ),
  },

  // 06 · PROOF (un-drainable close-loop)
  {
    id: 'proof', section: 'PROOF', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Why it is safe to be everywhere</Kicker>
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

  // 07 · ONBOARDING (Paystack, no crypto)
  {
    id: 'onboard', section: 'ONBOARDING',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Some users never touch crypto</Kicker>
        <M variants={rise} className={`${H1}`} style={ARTSIZE}>Fund with a card.<br />Bet from a <Emph delay={0.85}>tweet</Emph>.</M>
        <M variants={rise} className="mt-6 font-mono" style={{ ...lead, maxWidth: '64ch' }}>
          Pay in with your card through Paystack, sign in with Google, and gas is on us. Some users may never touch crypto at all. They fund with a card, then bet by replying to a tweet. More on-ramps are coming.
        </M>
        <M variants={rise} className="mt-9">
          <div className="flex" style={{ border: `1px solid ${HAIR}`, borderRadius: 12, overflow: 'hidden', background: CARD, maxWidth: 940 }}>
            {[[<LogoCard key="c" s={26} />, 'Card or bank', 'Paystack · test mode'], [<LogoGoogle key="g" s={20} />, 'Sign in with Google', 'zkLogin, no seed phrase'], [<span key="x" />, 'Gas on us', 'sponsored every bet']].map(([ic, n, l], i) => (
              <div key={i} className="flex-1" style={{ padding: '18px 22px', borderRight: i < 2 ? `1px solid ${HAIR}` : 'none' }}>
                <div className="flex items-center gap-2.5">{ic}<div className="font-display font-[700]" style={{ fontSize: 18, letterSpacing: '-0.02em', color: INK }}>{n}</div></div>
                <div className="mt-1.5"><Mono className="text-[10px]" style={{ color: MUTE }}>{l}</Mono></div>
              </div>
            ))}
          </div>
        </M>
      </div>
    ),
  },

  // 08 · MOBILE (where users are)
  {
    id: 'mobile', section: 'MOBILE', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-10">
        <div style={{ maxWidth: '50%' }}>
          <Kicker>Users live in apps</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>Where the users<br /><Emph delay={0.7}>are</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            If X, Instagram, and Telegram were web-only, they would not be what they are. People spend their time in mobile apps, and the app stores prove the scale. That is why we ship cross-platform native apps alongside the web app.
          </M>
          <M variants={rise} className="mt-7 flex gap-2.5 flex-wrap">
            <Pill tone="verm">Native iOS</Pill><Pill>Per-device wallet</Pill><Pill>Face ID + PIN</Pill>
          </M>
        </div>
        <PhoneMock tilt={-1.5} />
      </div>
    ),
  },

  // 09 · AI AGENTS (MCP + memwal)
  {
    id: 'agents', section: 'AI AGENTS',
    render: () => (
      <div className="w-full h-full flex items-center justify-between gap-12">
        <div style={{ maxWidth: '50%' }}>
          <Kicker>The next users are agents</Kicker>
          <M variants={rise} className={`${H1}`} style={DENSE}>Agents can bet.<br />They can't <Emph delay={0.85}>drain</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            We see the rise of AI agents, so we ship an MCP server. Any agent can read markets, price a strike, and place a bet through Yosuku, with memwal, our Walrus-backed memory, so it remembers. Non-custody means an agent can bet but can never touch the vault. Agent-ready before the wave lands.
          </M>
        </div>
        <SpecPanel title="MCP · AGENT TOOLS" badge="PUBLISHED" w={430} rows={[
          ['Read', 'Live markets + flow'],
          ['Price', 'Any strike, SVI to N(d2)'],
          ['Solvency', 'House check'],
          ['Trade', 'Open a position', true],
          ['Memory', 'memwal · Walrus', true],
        ]} />
      </div>
    ),
  },

  // 10 · REAL USAGE (demand)
  {
    id: 'demand', section: 'REAL USAGE', paper: PAPER2,
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>Do not trust us, trust the chain</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Real usage, read live<br />from the <Emph delay={0.85}>chain</Emph>.</M>
        <div className="mt-8 flex gap-4" style={{ maxWidth: 1020 }}>
          <StatCard value={<CountUp to={103} />} label="wallets onboarded, gas we sponsored" source="traction.ts · un-fakeable arrivals" />
          <StatCard value={<CountUp to={427} />} label="gas-free on-chain actions, each links to Suiscan" source="sponsor 0xe26c1184" hl />
          <StatCard value="2 in 3" label="arrivals who go on to place a bet" source="first-session activation" />
        </div>
        <M variants={rise} className="mt-7 font-mono" style={{ maxWidth: '84ch', fontSize: 14.5, color: BODY, lineHeight: 1.6 }}>
          Counted live from our own contracts at yosuku.xyz/stats, not self-reported emails. Plus the first TypeScript SDK for DeepBook Predict and an MCP server, with hundreds of npm installs.
        </M>
      </div>
    ),
  },

  // 11 · LONG-TERM REVENUE (the model)
  {
    id: 'revenue', section: 'LONG-TERM REVENUE',
    render: () => (
      <div className="w-full h-full flex flex-col justify-center">
        <Kicker>How this pays, long term</Kicker>
        <M variants={rise} className={`${H1}`} style={DENSE}>Free to bet.<br />Paid at <Emph delay={0.85}>scale</Emph>.</M>
        <div className="mt-8 flex gap-12" style={{ maxWidth: 1000 }}>
          <SpecPanel title="THE MODEL" w={430} rows={[
            ['Take rate', '0.3% of notional'],
            ['Per user', '~$2,500 traded / yr'],
            ['Revenue', '~$8 / user / yr', true],
            ['Base bet', 'Always free', true],
          ]} />
          <SpecPanel title="ANNUAL REVENUE AT SCALE" badge="ILLUSTRATIVE" badgeTone="verm" w={430} rows={[
            ['10,000 users', '~$80k / yr'],
            ['100,000 users', '~$800k / yr'],
            ['1,000,000 users', '~$8M / yr', true],
            ['Kalshi, 2025', '$23.8B · 1.14% take'],
          ]} />
        </div>
        <M variants={rise} className="mt-7 font-mono" style={{ maxWidth: '86ch', fontSize: 14.5, color: BODY, lineHeight: 1.6 }}>
          Illustrative. Our 0.3% take is a fraction of Kalshi's ~1.14% and sits under DeepBook's builder-fee cap. Base bets stay free, the builder fee flips on at mainnet, and memory passes plus copy-trade subscriptions add marketplace revenue on top.
        </M>
      </div>
    ),
  },

  // 12 · TECHNICAL + WHY SUI
  {
    id: 'why-sui', section: 'TECHNICAL · WHY SUI', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center justify-between gap-12">
        <Kanji className="absolute" style={{ bottom: '-30%', left: '-8%', fontSize: 'clamp(20rem,40vw,48rem)', color: 'rgba(20,18,16,0.04)', lineHeight: 1, zIndex: 0 }} />
        <div className="relative z-10" style={{ maxWidth: '44%' }}>
          <Kicker>Built on the Sui stack</Kicker>
          <M variants={rise} className={`${H1}`} style={ARTSIZE}>Only possible<br />on <Emph delay={0.7}>Sui</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>The venue, the un-drainable custody, the attestation, the private content, and gasless sign-in are all Sui-native, and all in our shipped code.</M>
        </div>
        <SpecPanel title="THE SUI STACK · IN CODE" badge="ALL NATIVE" w={440} rows={[
          ['Venue', 'DeepBook Predict · 0xdb3ef5a5', true],
          ['Custody', 'No-divert Move vault · 0x27931b56', true],
          ['Attestation', 'Nautilus TEE · 0x614a7412'],
          ['Private content', 'Seal · memory market'],
          ['Storage', 'Walrus · memwal, takes'],
          ['Sign-in', 'zkLogin · Google'],
          ['Gas', 'Sponsored · PTB'],
        ]} />
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
          <PhaseCard tag="NOW" tone="live" title="Testnet, live" body="Non-custodial bets and trade-from-X proven on-chain, gasless onboarding, a keeper that leaves winnings waiting, live /stats." />
          <PhaseCard tag="NEXT" title="Harden + retain" body="Finish the AWS Nitro enclave with production PCRs, ship mobile to TestFlight, wire mobile zkLogin, add more card on-ramps." />
          <PhaseCard tag="THEN" title="Mainnet + revenue" body="Flip the builder fee on, grow the marketplaces from seeded to fee-earning, expand the MCP and SDK for agent builders." />
        </div>
        <M variants={rise} className="mt-7 inline-flex items-center gap-3" style={{ borderTop: `2px solid ${GREEN}`, paddingTop: 12, alignSelf: 'flex-start' }}>
          <Mono className="text-[12px]" style={{ color: GREEN }}>EVERY NEXT ITEM MAPS TO A SEAM WE NAMED HONESTLY</Mono>
        </M>
      </div>
    ),
  },

  // 14 · CLOSE
  {
    id: 'close', section: 'THE ASK', paper: PAPER2,
    render: () => (
      <div className="relative w-full h-full flex items-center">
        <div className="relative z-10" style={{ maxWidth: '56%' }}>
          <Kicker>The ask</Kicker>
          <M variants={rise} className={`${H1}`} style={{ fontSize: 'clamp(2.4rem,6vw,5rem)' }}>Only you can<br /><Emph delay={0.7}>cash out</Emph>.</M>
          <M variants={rise} className="mt-6 font-mono" style={lead}>
            DeepBook built the engine. We bring it to where people already are: a tweet, a card, a phone, an agent. 103 wallets and 427 actions live on-chain, tweet-to-bet proven, non-custodial throughout.
          </M>
          <M variants={rise} className="mt-6 font-mono" style={{ fontSize: 15, color: INK, lineHeight: 1.5, maxWidth: '42ch' }}>
            Mainnet is a config flip. We want to take it there with the Sui and DeepBook teams. Verify us live at yosuku.xyz/stats.
          </M>
        </div>
        <div className="absolute" style={{ right: '5%', top: '50%', transform: 'translateY(-50%)' }}>
          <PhoneMock won tilt={2} />
        </div>
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
