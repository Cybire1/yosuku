'use client';

// SenseiDock — the floating dock that REPLACES the old countdown pill (TheBell).
// It keeps the timer's job (a draining ring + CLOSE time, urgent under a minute)
// but the whole orb is now Sensei: tap it and an award-winning side drawer springs
// in with the market-aware assistant (same /api/sensei brain as the /sensei page).
import { useState, useEffect, useRef, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { fetchSpot624, fetchMarkets624, inferCadence624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';

type Props = { targetTime?: number; now?: number };
type Msg = { role: 'user' | 'assistant'; content: string };
type MarketLite = { cadence: string; minsToClose: number; upLineUsd: number };
type Snapshot = { spotUsd: number; markets: MarketLite[] } | null;

const ROUND_SECS: Record<string, number> = { '1m': 60, '5m': 300, '1h': 3600 };
const R = 30, TAU = 2 * Math.PI * R;

const INTRO: Msg = {
  role: 'assistant',
  content:
    "I'm Sensei. I read the live Bitcoin market with you and give you a straight call — UP, DOWN, or sit it out. Ask me, or tap a starter. (Testnet — a read, not real-money advice, and I don't place trades yet.)",
};
const STARTERS = ['Read the current market', 'Up or down on the next close?', 'Is this a coin-flip?'];

function fmt(secs: number): string {
  const s = Math.max(0, secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

const REDUCE_MOTION = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Award-winning reveal: Sensei's reply types itself in, word by word, with a caret.
function Typewriter({ text, onDone, onType }: { text: string; onDone: () => void; onType?: () => void }) {
  const [n, setN] = useState(0);
  const words = text.split(/(\s+)/);
  useEffect(() => {
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      onType?.();
      if (i >= words.length) { clearInterval(id); onDone(); }
    }, 24);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (<>{words.slice(0, n).join('')}{n < words.length && <span className="sd-caret" aria-hidden />}</>);
}

// Interactive follow-ups: contextual chips under Sensei's answer the user can tap.
function chipsFor(reply: string): string[] {
  const r = reply.toLowerCase();
  if (/sit (this|it|the next|out)|coin.?flip|don'?t (take|bet)|skip it|take a breath|pause|tilt|no bet/.test(r)) return ['Good call — skip it', 'Show me another market', 'Why sit out?'];
  if (/\bup\b/.test(r) && /\bdown\b/.test(r)) return ['Why that side?', "What's the risk?", 'What would flip it?'];
  if (/risk|thin|tight|lean|shakeout/.test(r)) return ['What would flip it?', 'How much should I risk?', 'Read the next market'];
  return ['Why?', "What's the risk?", 'Read the next market'];
}

export default function SenseiDock({ targetTime, now }: Props) {
  const account = useCurrentAccount();
  const [secsLeft, setSecsLeft] = useState(0);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [msgs, setMsgs] = useState<Msg[]>([INTRO]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [typingIdx, setTypingIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendTimes = useRef<number[]>([]);

  // ── countdown (drives the draining ring) ──
  useEffect(() => {
    const compute = (clock: number) => (targetTime ? Math.max(0, Math.floor((targetTime - clock) / 1000)) : 0);
    if (now != null) { setSecsLeft(compute(now > 0 ? now : Date.now())); return; }
    const tick = () => setSecsLeft(compute(Date.now()));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [targetTime, now]);

  const roundSecs = targetTime ? (ROUND_SECS[inferCadence624(targetTime)] ?? 300) : 300;
  const frac = Math.max(0, Math.min(1, secsLeft / roundSecs));
  const urgent = secsLeft > 0 && secsLeft < 60;

  // ── market context (only while open; refresh 20s) ──
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      try {
        const [spot, markets] = await Promise.all([fetchSpot624(), fetchMarkets624()]);
        if (!alive) return;
        const near = [...markets].sort((a, b) => a.expiry - b.expiry).slice(0, 4).map((m) => ({
          cadence: inferCadence624(m.expiry), minsToClose: Math.max(0, Math.round((m.expiry - Date.now()) / 60000)), upLineUsd: Math.round(spot - BAND_USD),
        }));
        setSnapshot({ spotUsd: Math.round(spot), markets: near });
      } catch { /* keep last-good */ }
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);

  useEffect(() => { if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, loading, open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    const nowMs = Date.now();
    sendTimes.current = [...sendTimes.current, nowMs].filter((x) => nowMs - x < 180_000);
    const restless = sendTimes.current.length >= 4; // 4+ asks in 3 min → tilt cue for the Brake
    const next: Msg[] = [...msgs, { role: 'user', content: t }];
    setMsgs(next); setInput(''); setLoading(true);
    try {
      const res = await fetch('/api/sensei', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), market: snapshot, userId: account?.address, restless }),
      });
      const j = await res.json();
      const reply = res.ok && j.reply ? j.reply : (j.error || 'Something went wrong — try again.');
      setMsgs((m) => [...m, { role: 'assistant', content: reply }]);
      setTypingIdx(REDUCE_MOTION ? -1 : next.length);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error — try again.' }]);
    } finally { setLoading(false); }
  }, [msgs, snapshot, loading, account?.address]);

  return (
    <>
      {/* ── the dock: a draining countdown ring that IS Sensei ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Sensei AI — your trading assistant"
        data-cursor="hover"
        className={`sensei-dock ${urgent ? 'urgent' : ''} ${open ? 'is-open' : ''}`}
      >
        <span className="sensei-dock-avatar">
          <svg viewBox="0 0 72 72" className="sensei-dock-ring" aria-hidden>
            <circle cx="36" cy="36" r={R} className="sd-track" />
            <circle cx="36" cy="36" r={R} className="sd-fill" style={{ strokeDasharray: TAU, strokeDashoffset: TAU * (1 - frac) }} />
          </svg>
          <span className="sd-avatar-glyph">先</span>
        </span>
        <span className="sensei-dock-copy">
          <span className="sd-name">Sensei <b>AI</b></span>
          <span className="sd-sub">{targetTime ? `Read this round · ${fmt(secsLeft)}` : 'Ask the market'}</span>
        </span>
        <span className="sd-arrow" aria-hidden>→</span>
        <span className="sensei-dock-pulse" aria-hidden />
      </button>

      {/* ── the drawer ── */}
      <div className={`sensei-drawer-scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden={!open} />
      <aside className={`sensei-drawer ${open ? 'open' : ''}`} role="dialog" aria-label="Sensei" aria-modal={open}>
        <header className="sensei-drawer-head">
          <div>
            <div className="sd-eyebrow">先生 · Your trading assistant</div>
            <div className="sd-title">Sensei <span className="sd-beta">beta</span></div>
          </div>
          <div className="sd-head-right">
            {targetTime && <span className={`sd-nextclose ${urgent ? 'urgent' : ''}`}>Close {fmt(secsLeft)}</span>}
            <button className="sd-close" onClick={() => setOpen(false)} aria-label="Close" data-cursor="hover">✕</button>
          </div>
        </header>

        <div ref={scrollRef} className="sensei-drawer-msgs">
          {msgs.map((m, i) => (
            <div key={i} className={`sd-row ${m.role}`}>
              {m.role === 'assistant' && <span className="sd-ava" aria-hidden>先</span>}
              <div className={`sd-msg ${m.role}`}>
                {m.role === 'assistant' && i === typingIdx
                  ? <Typewriter text={m.content} onDone={() => setTypingIdx(-1)} onType={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })} />
                  : m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="sd-row assistant">
              <span className="sd-ava" aria-hidden>先</span>
              <div className="sd-msg assistant"><span className="sensei-dots"><i /><i /><i /></span></div>
            </div>
          )}
          {!loading && msgs.length > 1 && msgs[msgs.length - 1].role === 'assistant' && typingIdx === -1 && (
            <div className="sd-chips">
              {chipsFor(msgs[msgs.length - 1].content).map((c) => (
                <button key={c} className="sd-chip" onClick={() => send(c)} data-cursor="hover">{c}</button>
              ))}
            </div>
          )}
        </div>

        {msgs.length === 1 && (
          <div className="sensei-drawer-starters">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)} data-cursor="hover" className="sd-starter">{s}</button>
            ))}
          </div>
        )}

        <form className="sensei-drawer-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Sensei about the market…" />
          <button type="submit" disabled={loading || !input.trim()} data-cursor="hover">Ask</button>
        </form>
        <p className="sensei-drawer-foot">Reads the live market and gives you a call. Testnet — a read, not real-money advice. Doesn’t place trades yet.</p>
      </aside>
    </>
  );
}
