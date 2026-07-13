'use client';

// MarketRoom — self-contained mount of The Room for one market. Wires the gate
// state machine (useCommentRoom) to the CommentRoom UI, and supplies a wallet
// ConnectButton for the 'connect' state. Render it conditionally (when open).

import { ConnectButton } from '@mysten/dapp-kit';
import CommentRoom from './CommentRoom';
import { useCommentRoom } from '@/lib/sui/useCommentRoom';

export default function MarketRoom({
  marketId,
  callLabel,
  onClose,
  onBet,
}: {
  marketId: string;
  /** the call this room is about, e.g. "▼ BTC under $64,316 · 5m bell" */
  callLabel: string;
  onClose: () => void;
  /** jump the user to placing a bet (unlocks the room) */
  onBet?: () => void;
}) {
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
