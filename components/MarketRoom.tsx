'use client';

// MarketRoom — self-contained mount of The Room for one market.
//
// The room touches the wallet adapter, Seal, and the messaging SDK — any of which
// can throw in ways that vary by wallet/session and can't all be reproduced
// headlessly. So the whole thing is wrapped in an error boundary: if ANYTHING in
// the room throws during render, we show a contained fallback sheet (with the
// error surfaced) — the rest of the page keeps working, never a full-page crash.

import React from 'react';
import { ConnectButton } from '@mysten/dapp-kit';
import CommentRoom from './CommentRoom';
import { useCommentRoom } from '@/lib/sui/useCommentRoom';

interface RoomProps {
  marketId: string;
  /** the call this room is about, e.g. "▼ BTC under $64,316 · 5m bell" */
  callLabel: string;
  onClose: () => void;
  /** jump the user to placing a bet (unlocks the room) */
  onBet?: () => void;
}

class RoomErrorBoundary extends React.Component<
  { fallback: (e: Error) => React.ReactNode; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[room] crashed:', error?.message, '\n', error?.stack, '\n', info?.componentStack);
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

const sheetBg = { background: 'radial-gradient(130% 90% at 50% -10%, #16110c 0%, #0d0a08 46%, #080605 100%)' };

/** The live room — hooks + UI. If any of this throws during render, the boundary catches it. */
function RoomInner({ marketId, callLabel, onClose, onBet }: RoomProps) {
  const { gate, comments, busy, join, post } = useCommentRoom(marketId, true);
  return (
    <CommentRoom
      callLabel={callLabel}
      gate={gate}
      comments={comments}
      busy={busy}
      onClose={onClose}
      onJoin={join}
      onPost={post}
      onBet={onBet}
      connectSlot={
        <div className="[&_button]:!rounded-full [&_button]:!bg-vermilion [&_button]:!font-display">
          <ConnectButton connectText="Connect wallet" />
        </div>
      }
    />
  );
}

/** Shown if the room throws — contained sheet, page stays alive, error surfaced. */
function RoomFallback({ callLabel, onClose, error }: { callLabel: string; onClose: () => void; error: Error }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-label="Comment room">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div data-theme="dark" className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-t-3xl border border-white/[0.1] p-6 sm:rounded-3xl" style={sheetBg}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">The room</div>
            <div className="mt-0.5 truncate font-display text-[15px] font-bold text-white">{callLabel}</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white" aria-label="Close" style={{ outline: 'none' }}>✕</button>
        </div>
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <span aria-hidden className="text-[26px]">🛠️</span>
          <p className="font-display text-[15px] font-semibold text-white text-balance">The Room hit a snag opening.</p>
          <p className="font-mono text-[11px] leading-relaxed text-white/45">The rest of the app is unaffected. This is logged — if it keeps happening, screenshot this and send it over:</p>
          <code className="mt-1 block max-h-24 w-full overflow-auto rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-left font-mono text-[10px] leading-relaxed text-vermilion/80 break-all">
            {String(error?.message ?? error ?? 'unknown error').slice(0, 300)}
          </code>
        </div>
      </div>
    </div>
  );
}

export default function MarketRoom(props: RoomProps) {
  return (
    <RoomErrorBoundary fallback={(err) => <RoomFallback callLabel={props.callLabel} onClose={props.onClose} error={err} />}>
      <RoomInner {...props} />
    </RoomErrorBoundary>
  );
}
