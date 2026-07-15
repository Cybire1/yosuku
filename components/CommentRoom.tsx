'use client';

// The Room — the position-gated, end-to-end-encrypted comment thread under a market.
// Only wallets that bet the market can read + post (on-chain gate:
// market_room_rule::join → bet_registry::has_bet); messages are E2E-encrypted via the
// Sui Stack Messaging SDK + Seal.
//
// Gate states: connect → locked (no position) → joinable (has position) → joining
// → joined (thread + composer).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock, ShieldCheck, Send, Loader2, X, ArrowRight, Sparkles } from 'lucide-react';

export type RoomGate = 'connect' | 'locked' | 'joinable' | 'joining' | 'joined';

export interface RoomComment {
  id: string;
  author: string;
  text: string;
  tsMs: number;
  mine?: boolean;
  verified?: boolean; // SDK re-derived sender == signer (senderVerified)
}

const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || 'anon');
function timeAgo(ms: number): string {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function hue(addr: string): number {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 12); i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}

const MAX_LEN = 280;

/** Bespoke Room mark: a locked speech bubble — "encrypted conversation" in one glyph. */
function RoomMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M5.2 3.6h13.6A2.7 2.7 0 0 1 21.5 6.3v7A2.7 2.7 0 0 1 18.8 16H11l-4.3 3.5a.6.6 0 0 1-1-.47V16H5.2A2.7 2.7 0 0 1 2.5 13.3v-7A2.7 2.7 0 0 1 5.2 3.6Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      <rect x="8.9" y="9.7" width="6.2" height="4.5" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.4 9.7V8.4a1.6 1.6 0 0 1 3.2 0v1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** A haloed state icon — the focal mark for each onboarding state. */
function StateIcon({ children, tone = 'vermilion' }: { children: ReactNode; tone?: 'vermilion' | 'muted' }) {
  const v = tone === 'vermilion';
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ background: v ? 'radial-gradient(circle, rgba(224,77,38,0.28), transparent 70%)' : 'radial-gradient(circle, rgba(255,255,255,0.10), transparent 70%)' }}
      />
      <div
        className="relative flex h-14 w-14 items-center justify-center rounded-2xl border"
        style={{
          borderColor: v ? 'rgba(224,77,38,0.35)' : 'rgba(255,255,255,0.12)',
          background: v ? 'rgba(224,77,38,0.06)' : 'rgba(255,255,255,0.03)',
          color: v ? 'var(--vermilion)' : 'rgba(255,255,255,0.5)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function CommentRoom({
  callLabel,
  gate,
  comments,
  onClose,
  onJoin,
  onPost,
  onBet,
  busy,
  error,
  connectSlot,
}: {
  /** the call this room is about, e.g. "▼ BTC under $64,316" */
  callLabel: string;
  gate: RoomGate;
  comments: RoomComment[];
  onClose: () => void;
  onJoin?: () => void;
  onPost?: (text: string) => void;
  onBet?: () => void;
  busy?: boolean;
  error?: string | null;
  connectSlot?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const [mounted, setMounted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true)); // entrance transition
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  useEffect(() => {
    if (gate === 'joined' && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length, gate]);

  const send = () => {
    const t = draft.replace(/\s+/g, ' ').trim();
    if (!t || busy) return;
    onPost?.(t.slice(0, MAX_LEN));
    setDraft('');
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-label="The Room">
      <div className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} aria-hidden="true" />
      <div
        data-theme="dark"
        className={`relative z-10 flex max-h-[88dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border border-white/[0.1] shadow-[0_-20px_80px_-20px_rgba(224,77,38,0.25)] transition-all duration-300 ease-out sm:rounded-3xl ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
        style={{ background: 'radial-gradient(130% 90% at 50% -10%, #1a130d 0%, #0d0a08 46%, #080605 100%)' }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/70 to-transparent" />

        {/* header */}
        <div className="relative z-10 flex items-start gap-3.5 border-b border-white/[0.08] p-5">
          <div
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-vermilion/30 text-vermilion"
            style={{ background: 'rgba(224,77,38,0.08)', boxShadow: '0 0 24px -6px rgba(224,77,38,0.5)' }}
          >
            <RoomMark size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[15px] font-bold text-white">{callLabel}</div>
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/45">
              <Lock size={9} className="text-vermilion/80" strokeWidth={2.4} /> Bettors only · Encrypted
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="Close" style={{ outline: 'none' }}>
            <X size={16} />
          </button>
        </div>

        {/* body */}
        {gate === 'connect' && (
          <div className="relative z-10 flex flex-col items-center gap-4 p-9 text-center">
            <StateIcon tone="muted"><RoomMark size={26} /></StateIcon>
            <p className="font-display text-[17px] font-semibold text-white text-balance">A private room, per market.</p>
            {connectSlot}
          </div>
        )}

        {gate === 'locked' && (
          <div className="relative z-10 flex flex-col items-center gap-4 p-9 text-center">
            <StateIcon tone="muted"><Lock size={24} strokeWidth={1.8} /></StateIcon>
            <p className="font-display text-[17px] font-semibold text-white text-balance">Skin in the game unlocks the room.</p>
            <button onClick={onBet} style={{ outline: 'none' }} className="group mt-1 inline-flex items-center gap-2 rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-vermilion-d hover:gap-2.5">
              Place a bet to unlock <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        )}

        {(gate === 'joinable' || gate === 'joining') && (
          <div className="relative z-10 flex flex-col items-center gap-4 p-9 text-center">
            <StateIcon tone="vermilion"><ShieldCheck size={26} strokeWidth={1.8} /></StateIcon>
            <p className="font-display text-[17px] font-semibold text-white text-balance">Your position's verified.</p>
            <button onClick={onJoin} disabled={gate === 'joining'} style={{ outline: 'none' }} className="mt-1 inline-flex items-center gap-2 rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-vermilion-d disabled:opacity-60">
              {gate === 'joining' ? <><Loader2 size={15} className="animate-spin" /> Joining…</> : <>Join the room</>}
            </button>
            {error && (
              <code className="mt-1 block max-h-28 w-full overflow-auto rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-left font-mono text-[10px] leading-relaxed text-vermilion/80 break-all">
                {error}
              </code>
            )}
          </div>
        )}

        {gate === 'joined' && (
          <>
            <div ref={listRef} className="relative z-10 flex-1 space-y-1 overflow-y-auto p-4">
              {comments.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <StateIcon tone="muted"><Sparkles size={22} strokeWidth={1.8} /></StateIcon>
                  <p className="font-mono text-[11px] text-white/35">Quiet in here. Break the ice.</p>
                </div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className={`group flex items-start gap-2.5 rounded-xl px-2 py-1.5 ${c.mine ? '' : ''}`}>
                    <span
                      aria-hidden
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-full ring-1 ring-white/10"
                      style={{ background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue(c.author)} 60% 56%), hsl(${(hue(c.author) + 40) % 360} 48% 26%))` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono text-[10px]">
                        <span className={c.mine ? 'font-semibold text-vermilion' : 'text-white/70'}>{c.mine ? 'You' : shortAddr(c.author)}</span>
                        {c.verified && <ShieldCheck size={10} className="text-emerald-400/70" strokeWidth={2.2} aria-label="signature verified" />}
                        <span className="text-white/25">· {timeAgo(c.tsMs)}</span>
                      </div>
                      <p className="mt-0.5 font-sans text-[13.5px] leading-snug text-white/90 break-words">{c.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* composer */}
            <div className="relative z-10 border-t border-white/[0.08] p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
              <div className="flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.02] px-3 py-2 transition-colors focus-within:border-vermilion/40">
                <Lock size={13} className="mb-2 shrink-0 text-white/25" strokeWidth={2.2} aria-label="end-to-end encrypted" />
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Say it to the room…"
                  rows={1}
                  className="max-h-24 min-h-[24px] flex-1 resize-none bg-transparent font-sans text-[13.5px] leading-snug text-white outline-none placeholder:text-white/25"
                />
                <button onClick={send} disabled={!draft.trim() || busy} style={{ outline: 'none' }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vermilion text-white transition-all hover:bg-vermilion-d disabled:opacity-30" aria-label="Post">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={2.2} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
