'use client';

// SenseiDock — the floating dock that REPLACES the old countdown pill (TheBell).
// It keeps the timer's job (a draining ring + CLOSE time, urgent under a minute)
// but the whole orb is now Sensei: tap it and an award-winning side drawer springs
// in with the market-aware assistant (same /api/sensei brain as the /sensei page).
import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { fetchSpot624, fetchMarkets624, fetchPythHistory624, inferCadence624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';
import SenseiTradeCards from './SenseiTradeCards';

type Props = { targetTime?: number; now?: number };
type Msg = { role: 'user' | 'assistant'; content: string };
type MarketLite = { cadence: string; minsToClose: number; upLineUsd: number };
type Snapshot = { spotUsd: number; markets: MarketLite[] } | null;

const ROUND_SECS: Record<string, number> = { '1m': 60, '5m': 300, '1h': 3600 };
const R = 30, TAU = 2 * Math.PI * R;

const INTRO: Msg = {
  role: 'assistant',
  content:
    "I'm Sensei. I read the live Bitcoin market with you and give you a straight call. UP, DOWN, or sit it out. Then act on it right here: tap a market below to trade, gas-free. (Testnet. Test funds only. I read and recommend, you place the trade.)",
};
const STARTERS = ['Read the current market', 'Up or down on the next close?', 'Is this a coin-flip?'];
// Cute one-liners the dock pops to invite a tap (short, plain, no jargon).
const TEASERS = ['Up or down?', 'Coin-flip?', 'Want a read?', 'Which way?'];

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
  if (/sit (this|it|the next|out)|coin.?flip|don'?t (take|bet)|skip it|take a breath|pause|tilt|no bet/.test(r)) return ['Good call, skip it', 'Show me another market', 'Why sit out?'];
  if (/\bup\b/.test(r) && /\bdown\b/.test(r)) return ['Why that side?', "What's the risk?", 'What would flip it?'];
  if (/risk|thin|tight|lean|shakeout/.test(r)) return ['What would flip it?', 'How much should I risk?', 'Read the next market'];
  return ['Why?', "What's the risk?", 'Read the next market'];
}

// ── the live market read (meter) — drift from REAL Pyth history, never the fake ~$20 line ──
type PricePt = { usd: number; tsMs: number };
type Drift = { usd: number; spanMin: number; dir: 'up' | 'down' | 'flat' };
const DRIFT_WINDOW_MIN: Record<string, number> = { '1m': 1, '5m': 5, '1h': 15 };
const HIST_LIMIT: Record<string, number> = { '1m': 90, '5m': 300, '1h': 360 };

// Directional drift over the cadence window, measured on the SAME feed that settles
// markets. spanMin is the ACTUAL span held — it never overstates the window.
function computeDrift(hist: PricePt[], cadence: string): Drift | null {
  if (!hist || hist.length < 2) return null;
  const windowMins = DRIFT_WINDOW_MIN[cadence] ?? 5;
  const latest = hist[hist.length - 1];
  const cutoff = latest.tsMs - windowMins * 60_000;
  let chosen = hist[0];
  for (let i = 0; i < hist.length; i++) { if (hist[i].tsMs >= cutoff) { chosen = hist[i]; break; } }
  const usd = latest.usd - chosen.usd;
  const spanMin = Math.max(0, Math.round((latest.tsMs - chosen.tsMs) / 60_000));
  const dir: Drift['dir'] = Math.abs(usd) <= 3 ? 'flat' : usd > 0 ? 'up' : 'down';
  return { usd, spanMin, dir };
}

// Featherweight sparkline points, auto-ranged to the window's own min/max — a near-flat
// tape stays a flat line, so noise never renders as a fake trend.
function sparkPoints(hist: PricePt[]): { W: number; pts: string; lastX: number; lastY: number } | null {
  const n = hist.length;
  if (n < 2) return null;
  const ys = hist.map((p) => p.usd);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min;
  const W = n - 1;
  let lastY = 6;
  const pts = hist
    .map((p, i) => {
      const y = span < 1 ? 6 : 11 - ((p.usd - min) / span) * 10;
      lastY = +y.toFixed(2);
      return `${i},${+y.toFixed(2)}`;
    })
    .join(' ');
  return { W, pts, lastX: W, lastY };
}

export default function SenseiDock({ targetTime, now }: Props) {
  const account = useCurrentAccount();
  const [secsLeft, setSecsLeft] = useState(0);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [hist, setHist] = useState<PricePt[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([INTRO]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [typingIdx, setTypingIdx] = useState(-1);
  const [teaserIdx, setTeaserIdx] = useState(-1); // -1 = hidden; pops a rotating question
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
  const cadence = targetTime ? inferCadence624(targetTime) : '5m';
  const drift = useMemo(() => computeDrift(hist, cadence), [hist, cadence]);
  const spark = useMemo(() => sparkPoints(hist), [hist]);

  // ── market context (only while open; refresh 20s) ──
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      try {
        const [spot, markets] = await Promise.all([fetchSpot624(), fetchMarkets624()]);
        if (alive) {
          const near = [...markets].sort((a, b) => a.expiry - b.expiry).slice(0, 4).map((m) => ({
            cadence: inferCadence624(m.expiry), minsToClose: Math.max(0, Math.round((m.expiry - Date.now()) / 60000)), upLineUsd: Math.round(spot - BAND_USD),
          }));
          setSnapshot({ spotUsd: Math.round(spot), markets: near });
        }
      } catch { /* keep last-good */ }
      // live price tape for the meter — its OWN catch, so a history hiccup never blanks spot
      const limit = targetTime ? (HIST_LIMIT[inferCadence624(targetTime)] ?? 300) : 300;
      const h = await fetchPythHistory624(limit).catch(() => null);
      if (alive && h && h.length) setHist(h);
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [open, targetTime]);

  useEffect(() => { if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, loading, open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cute proactive teaser: pops a short rotating question a few times to invite a tap,
  // then rests. Hidden while the drawer is open or under reduced-motion.
  useEffect(() => {
    if (open || REDUCE_MOTION) { setTeaserIdx(-1); return; }
    let i = 0, alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = (delay: number) => {
      timers.push(setTimeout(() => {
        if (!alive) return;
        setTeaserIdx(i % TEASERS.length);
        timers.push(setTimeout(() => {
          if (!alive) return;
          setTeaserIdx(-1); i += 1;
          if (i < 3) cycle(4500);
        }, 4800));
      }, delay));
    };
    cycle(3500);
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [open]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    const nowMs = Date.now();
    sendTimes.current = [...sendTimes.current, nowMs].filter((x) => nowMs - x < 180_000);
    const restless = sendTimes.current.length >= 4; // 4+ asks in 3 min → tilt cue for the Brake
    const next: Msg[] = [...msgs, { role: 'user', content: t }];
    setMsgs(next); setInput(''); setLoading(true);
    try {
      // Never ask Sensei blind. If the drawer's market context hasn't landed yet
      // (a fast first tap beats the 20s loader), fetch it inline so the read is
      // grounded instead of an honest-but-useless "I see no live market data"
      // refusal. Only if the chain is truly unreachable do we send null and let
      // Sensei say so.
      let market = snapshot;
      if (!market) {
        try {
          const [spot, markets] = await Promise.all([fetchSpot624(), fetchMarkets624()]);
          const near = [...markets].sort((a, b) => a.expiry - b.expiry).slice(0, 4).map((m) => ({
            cadence: inferCadence624(m.expiry), minsToClose: Math.max(0, Math.round((m.expiry - Date.now()) / 60000)), upLineUsd: Math.round(spot - BAND_USD),
          }));
          market = { spotUsd: Math.round(spot), markets: near };
          setSnapshot(market);
        } catch { /* chain really unreachable: Sensei will say so honestly */ }
      }
      const res = await fetch('/api/sensei', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), market, userId: account?.address, restless }),
      });
      const j = await res.json();
      const reply = res.ok && j.reply ? j.reply : (j.error || 'Something went wrong. Try again.');
      setMsgs((m) => [...m, { role: 'assistant', content: reply }]);
      setTypingIdx(REDUCE_MOTION ? -1 : next.length);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error. Try again.' }]);
    } finally { setLoading(false); }
  }, [msgs, snapshot, loading, account?.address]);

  return (
    <>
      {/* ── the dock: a compact 先 mark that expands on hover, plus a cute question teaser ── */}
      <div className="sensei-dock-wrap">
        {teaserIdx >= 0 && !open && (
          <button
            key={teaserIdx}
            type="button"
            className="sensei-teaser"
            onClick={() => setOpen(true)}
            aria-label={`Ask Sensei: ${TEASERS[teaserIdx]}`}
            data-cursor="hover"
          >
            {TEASERS[teaserIdx]}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Sensei AI, your trading assistant"
          data-cursor="hover"
          className={`sensei-dock ${urgent ? 'urgent' : ''} ${open ? 'is-open' : ''}`}
        >
          <span className="sensei-dock-copy"><span className="sd-name">Sensei <b>AI</b></span></span>
          <span className="sensei-dock-avatar">
            <svg viewBox="0 0 72 72" className="sensei-dock-ring" aria-hidden>
              <circle cx="36" cy="36" r={R} className="sd-track" />
              <circle cx="36" cy="36" r={R} className="sd-fill" style={{ strokeDasharray: TAU, strokeDashoffset: TAU * (1 - frac) }} />
            </svg>
            <span className="sd-avatar-glyph">先</span>
            <span className="sensei-dock-pulse" aria-hidden />
          </span>
        </button>
      </div>

      {/* ── the drawer ── */}
      <div className={`sensei-drawer-scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden={!open} />
      <aside className={`sensei-drawer ${open ? 'open' : ''}`} role="dialog" aria-label="Sensei" aria-modal={open}>
        <header className="sensei-drawer-head">
          <div>
            <div className="sd-eyebrow">先生 · Your trading assistant</div>
            <div className="sd-title">Sensei <span className="sd-beta">beta</span></div>
          </div>
          <div className="sd-head-right">
            <button className="sd-close" onClick={() => setOpen(false)} aria-label="Close" data-cursor="hover">✕</button>
          </div>
        </header>

        {/* live market read — a pinned hairline strip that anchors every reply below it */}
        <div className={`sensei-meter sd-dir-${drift?.dir ?? 'flat'} ${urgent ? 'urgent' : ''}`}>
          <div className="sm-read">
            <span className="sm-spot">{snapshot ? `$${snapshot.spotUsd.toLocaleString()}` : '···'}</span>
            {drift && (
              <>
                <span className="sm-tri" aria-hidden />
                <span className="sm-drift">
                  {drift.dir === 'flat'
                    ? 'flat'
                    : `${drift.usd > 0 ? '+' : '−'}$${Math.abs(Math.round(drift.usd)).toLocaleString()}`}
                </span>
                <span className="sm-window">{drift.spanMin < 1 ? '<1 min' : `${drift.spanMin} min`}</span>
              </>
            )}
            <span className="sm-spacer" />
            {targetTime && (
              <span className="sm-time">
                <span className="sm-time-num">{fmt(secsLeft)}</span>
                <span className="sm-time-lab">left</span>
                <span className="sm-drain" style={{ '--frac': frac } as CSSProperties} aria-hidden />
              </span>
            )}
          </div>
          {spark ? (
            <div className="sm-spark-wrap">
              <svg className="sm-spark" viewBox={`0 0 ${spark.W} 12`} preserveAspectRatio="none" aria-hidden>
                <polyline points={spark.pts} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {/* round now-dot as an HTML overlay — a <circle> in the stretched SVG would smear into an ellipse */}
              <i className="sm-dot" style={{ top: `${(spark.lastY / 12) * 100}%` } as CSSProperties} aria-hidden />
            </div>
          ) : (
            <div className="sm-spark-empty">reading the market…</div>
          )}
        </div>

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

        {/* control center: the trade cards appear only once Sensei has actually
            given a read (any reply past the intro) or you asked to trade — not
            pinned open by default. Action follows the recommendation. */}
        {msgs.some((m, i) => i > 0 && m.role === 'assistant') && <SenseiTradeCards active={open} />}

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
      </aside>
    </>
  );
}
