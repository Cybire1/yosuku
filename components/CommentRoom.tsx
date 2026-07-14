'use client';

// The Room — the position-gated comment thread under a take. Only people who bet
// the market can read + post; the door is our on-chain gate (market_room_rule::join,
// which checks bet_registry::has_bet), and the messages are E2E-encrypted through
// the Sui Stack Messaging SDK (Seal). This component is the UI + gate-state UX; the
// live send/read is wired in lib/sui/comments.ts once the relayer is public.
//
// Gate states: connect → locked (no position) → joinable (has position) → joining
// → joined (thread + composer).

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  /** surfaced join/post error, shown inline instead of failing silently */
  error?: string | null;
  /** a <ConnectButton/> passed in for the 'connect' state */
  connectSlot?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // stick to newest when joined
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
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-label="Comment room">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        data-theme="dark"
        className="relative z-10 flex max-h-[88dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border border-white/[0.1] sm:rounded-3xl"
        style={{ background: 'radial-gradient(130% 90% at 50% -10%, #16110c 0%, #0d0a08 46%, #080605 100%)' }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/60 to-transparent" />

        {/* header */}
        <div className="relative z-10 flex items-start justify-between gap-3 border-b border-white/[0.08] p-5">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">The room</div>
            <div className="mt-0.5 truncate font-display text-[15px] font-bold text-white">{callLabel}</div>
            <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-[9px] text-white/40">
              <span className="text-vermilion/80">🔒</span> bettors only · end-to-end encrypted
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="Close" style={{ outline: 'none' }}>✕</button>
        </div>

        {/* body */}
        {gate === 'connect' && (
          <div className="relative z-10 flex flex-col items-center gap-3 p-8 text-center">
            <span aria-hidden className="font-jp text-[34px] text-white/15">賭</span>
            <p className="font-mono text-[12px] leading-relaxed text-white/55">Connect your wallet to see the room.</p>
            {connectSlot}
          </div>
        )}

        {gate === 'locked' && (
          <div className="relative z-10 flex flex-col items-center gap-3 p-8 text-center">
            <span aria-hidden className="text-[30px]">🔒</span>
            <p className="font-display text-[17px] font-semibold text-white text-balance">Only people who bet this market can talk here.</p>
            <p className="font-mono text-[11px] leading-relaxed text-white/45">Skin in the game unlocks the room — no lurkers, no talk without a position.</p>
            <button onClick={onBet} style={{ outline: 'none' }} className="mt-1 rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-vermilion-d">
              Place a bet to unlock
            </button>
          </div>
        )}

        {(gate === 'joinable' || gate === 'joining') && (
          <div className="relative z-10 flex flex-col items-center gap-3 p-8 text-center">
            <span className="rounded-full border border-vermilion/40 bg-vermilion/[0.08] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-vermilion">✓ position</span>
            <p className="font-display text-[17px] font-semibold text-white text-balance">You've got skin in this market.</p>
            <p className="font-mono text-[11px] leading-relaxed text-white/45">Join the room to read the thread and post. One signature to prove your position — gas-free.</p>
            <button onClick={onJoin} disabled={gate === 'joining'} style={{ outline: 'none' }} className="mt-1 rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-vermilion-d disabled:opacity-60">
              {gate === 'joining' ? 'Joining…' : 'Join the room'}
            </button>
            {error && (
              <code className="mt-2 block max-h-28 w-full overflow-auto rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-left font-mono text-[10px] leading-relaxed text-vermilion/80 break-all">
                {error}
              </code>
            )}
          </div>
        )}

        {gate === 'joined' && (
          <>
            <div ref={listRef} className="relative z-10 flex-1 space-y-4 overflow-y-auto p-5">
              {comments.length === 0 ? (
                <p className="py-10 text-center font-mono text-[11px] text-white/35">No one's said anything yet. Break the ice.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-0.5 h-7 w-7 shrink-0 rounded-full ring-1 ring-white/10" style={{ background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue(c.author)} 55% 55%), hsl(${(hue(c.author) + 40) % 360} 45% 28%))` }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono text-[10px]">
                        <span className={c.mine ? 'text-vermilion' : 'text-white/70'}>{c.mine ? 'you' : shortAddr(c.author)}</span>
                        {c.verified && <span className="text-white/30" title="signature verified">✓</span>}
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
              <div className="flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.02] px-3 py-2 focus-within:border-vermilion/40">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Say it to the room…"
                  rows={1}
                  className="max-h-24 min-h-[24px] flex-1 resize-none bg-transparent font-sans text-[13.5px] leading-snug text-white outline-none placeholder:text-white/25"
                />
                <button onClick={send} disabled={!draft.trim() || busy} style={{ outline: 'none' }} className="shrink-0 rounded-full bg-vermilion px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-vermilion-d disabled:opacity-40">
                  {busy ? '…' : 'Post'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
