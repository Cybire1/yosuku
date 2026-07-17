'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import Marquee from '@/components/Marquee';
import { fetchSpot624, fetchMarkets624, inferCadence624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';

type Msg = { role: 'user' | 'assistant'; content: string };
type MarketLite = { cadence: string; minsToClose: number; upLineUsd: number };
type Snapshot = { spotUsd: number; markets: MarketLite[] } | null;

const INTRO: Msg = {
  role: 'assistant',
  content:
    "I'm Sensei. I read the live Bitcoin market with you and give you a straight call. UP, DOWN, or sit it out. Ask me anything, or tap a starter below. (Testnet. This is a read, not real-money advice, and I don't place trades yet.)",
};

const STARTERS = [
  'Read the current BTC market for me',
  'Up or down on the next close?',
  'Is this one a coin-flip?',
  'How do these markets work?',
];

export default function SenseiPage() {
  const account = useCurrentAccount();
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [msgs, setMsgs] = useState<Msg[]>([INTRO]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendTimes = useRef<number[]>([]);

  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  // Gather the live market context the brain reasons over (refreshed ~20s).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [spot, markets] = await Promise.all([fetchSpot624(), fetchMarkets624()]);
        if (!alive) return;
        const near = [...markets].sort((a, b) => a.expiry - b.expiry).slice(0, 4).map((m) => ({
          cadence: inferCadence624(m.expiry),
          minsToClose: Math.max(0, Math.round((m.expiry - Date.now()) / 60000)),
          upLineUsd: Math.round(spot - BAND_USD),
        }));
        setSnapshot({ spotUsd: Math.round(spot), markets: near });
      } catch { /* leave last-good */ }
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, loading]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    const nowMs = Date.now();
    sendTimes.current = [...sendTimes.current, nowMs].filter((x) => nowMs - x < 180_000);
    const restless = sendTimes.current.length >= 4; // 4+ asks in 3 min → tilt cue for the Brake
    const next: Msg[] = [...msgs, { role: 'user', content: t }];
    setMsgs(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/sensei', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), market: snapshot, userId: account?.address, restless }),
      });
      const j = await res.json();
      setMsgs((m) => [...m, { role: 'assistant', content: res.ok && j.reply ? j.reply : (j.error || 'Something went wrong. Try again.') }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error. Try again in a moment.' }]);
    } finally {
      setLoading(false);
    }
  }, [msgs, snapshot, loading, account?.address]);

  const nearest = snapshot?.markets[0];

  return (
    <div className="min-h-screen relative flex flex-col">
      <Marquee />
      <Header />
      <GrainOverlay />
      <CustomCursor />

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 pt-[120px] pb-6 flex flex-col">
        {/* header */}
        <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">先生 · Your trading assistant</div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display font-[800] text-3xl sm:text-[34px] text-white leading-none">Sensei</h1>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion border border-vermilion/40 rounded-full px-2 py-0.5">beta</span>
            </div>
          </div>
          {/* live market chip */}
          <div className="shrink-0 text-right">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">BTC now</div>
            <div className="font-display font-[700] text-lg text-white tabular-nums">
              {snapshot ? `$${snapshot.spotUsd.toLocaleString()}` : '···'}
            </div>
            {nearest && now > 0 && (
              <div className="font-mono text-[10px] text-gray-500">next close ~{nearest.minsToClose}m · {nearest.cadence}</div>
            )}
          </div>
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-4 min-h-[46vh]">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-vermilion text-white rounded-br-md'
                  : 'bg-white/[0.04] border border-white/[0.08] text-gray-100 rounded-bl-md'
              }`}>
                {m.role === 'assistant' && (
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-vermilion/80 mb-1.5">Sensei</div>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/[0.08] px-4 py-3">
                <span className="sensei-dots"><i /><i /><i /></span>
              </div>
            </div>
          )}
        </div>

        {/* starters (only before the first user turn) */}
        {msgs.length === 1 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)} data-cursor="hover"
                className="rounded-full border border-white/[0.12] bg-white/[0.02] px-3.5 py-2 text-[12.5px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        {/* input */}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Sensei about the market…"
            className="flex-1 rounded-full bg-white/[0.03] border border-white/[0.1] px-4 py-3 text-[14px] text-white placeholder:text-gray-600 outline-none focus:border-vermilion/50 transition-colors"
          />
          <button type="submit" disabled={loading || !input.trim()} data-cursor="hover"
            className="shrink-0 rounded-full bg-vermilion hover:bg-vermilion-d disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[13px] px-5 py-3 transition-colors">
            Ask
          </button>
        </form>
        <p className="font-mono text-[10px] text-gray-600 mt-3 leading-relaxed">
          Sensei reads the live market and gives you a call. Testnet, test funds, not real money. It doesn’t place trades yet.
        </p>
      </main>
    </div>
  );
}
