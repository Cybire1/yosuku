'use client';

// useCommentRoom — drives The Room's gate state machine.
//
//   connect  no wallet
//   locked   wallet, but no bet on this market (can't talk)
//   joinable has a bet, not yet a room member → one tap to join
//   joining  join in flight (record delegate → create-or-find room → gated join)
//   joined   member: thread + composer, polled live
//
// TWO identities (see lib/sui/roomDelegate.ts for why):
//  • the zkLogin/Google WALLET (`account`) is the LOGIN + position gate — checkHasBet
//    reads the OWNER's real bet. It never touches the messaging layer.
//  • a per-user Ed25519 DELEGATE runs ALL messaging: the relayer auth, the Seal
//    SessionKey, per-message signing, and the on-chain room membership (record + join,
//    Onara-sponsored). zkLogin's flag-0x05 signature is rejected by the messaging SDK +
//    relayer; the delegate's flag-0x00 signature is the scheme that already works.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useRoomDelegate } from './roomDelegate';
import { useSmartSubmit } from './useSmartSubmit';
import {
  getMessagingClient,
  findMarketRoom,
  ensureMarketRoom,
  joinRoom,
  postComment,
  fetchComments,
  checkHasBet,
  buildRecordBetTx,
} from './comments';
import type { RoomComment, RoomGate } from '@/components/CommentRoom';

const RELAYER_SYNC_MS = 14_000; // let the relayer see the on-chain permission grant
const POLL_MS = 9_000;

export interface UseCommentRoom {
  gate: RoomGate;
  comments: RoomComment[];
  busy: boolean;
  /** surfaced join/post failure (so the UI can show it instead of failing silently) */
  error: string | null;
  join: () => Promise<void>;
  post: (text: string) => Promise<void>;
}

export function useCommentRoom(marketId: string | null, open: boolean): UseCommentRoom {
  const account = useCurrentAccount();
  const delegate = useRoomDelegate(account?.address); // Ed25519 messaging identity (see header)
  const { submitAs } = useSmartSubmit();
  // one client per delegate → one Seal SessionKey (created lazily on first encrypted op).
  const client = useMemo(() => (delegate ? getMessagingClient(delegate) : null), [delegate]);

  const [gate, setGate] = useState<RoomGate>('connect');
  const [comments, setComments] = useState<RoomComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<{ ruleId: string; groupId: string } | null>(null);
  // comments are authored by the DELEGATE address (its keypair signs the messages).
  const me = delegate?.toSuiAddress();

  // reset room refs + thread when the market changes.
  useEffect(() => {
    roomRef.current = null;
    setComments([]);
  }, [marketId]);

  // resolve the gate whenever opened / wallet changes.
  useEffect(() => {
    if (!open || !marketId) return;
    if (!account || !delegate || !client) { setGate('connect'); return; }
    let cancelled = false;
    (async () => {
      // gate on the OWNER's real position (zkLogin wallet), not the delegate.
      const hasBet = await checkHasBet(account.address, marketId);
      if (cancelled) return;
      if (!hasBet) { setGate('locked'); return; }
      // owner holds a position — if a room exists, probe the DELEGATE's membership by reading it.
      const room = await findMarketRoom(marketId);
      if (cancelled) return;
      if (room) {
        roomRef.current = room;
        try {
          const msgs = await fetchComments(client, delegate, marketId, me);
          if (cancelled) return;
          setComments(msgs);
          setGate('joined');
          return;
        } catch {
          // room exists but the delegate isn't a member yet → joinable
        }
      }
      if (!cancelled) setGate('joinable');
    })();
    return () => { cancelled = true; };
  }, [open, marketId, account, delegate, client, me]);

  // poll the thread while joined.
  useEffect(() => {
    if (gate !== 'joined' || !open || !marketId || !client || !delegate) return;
    let stop = false;
    const id = setInterval(async () => {
      try {
        const msgs = await fetchComments(client, delegate, marketId, me);
        if (!stop) setComments(msgs);
      } catch { /* transient relayer/read hiccup — next tick retries */ }
    }, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [gate, open, marketId, client, delegate, me]);

  const join = useCallback(async () => {
    if (!marketId || !client || !delegate) return;
    setError(null);
    setGate('joining');
    const submitDelegate = (factory: () => Transaction | Promise<Transaction>) => submitAs(delegate, factory);
    try {
      // 1) self-attest the DELEGATE as a bettor so market_room_rule::join grants it read+post.
      //    Gated by the owner's real bet (already checked → gate was 'joinable'). Onara-sponsored.
      //    record is idempotent per (addr, market); swallow an "already recorded" abort.
      try {
        await submitDelegate(() => buildRecordBetTx(marketId));
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        if (!/vec_set|abort code: 0|already/i.test(m)) throw e; // real failure (e.g. sponsor down) → bubble up
      }
      // 2) create-or-find the room (server-side; gas-free for the user).
      const room = await ensureMarketRoom(marketId);
      roomRef.current = room;
      // 3) the DELEGATE joins the room (Onara-sponsored; retries + already-member handling).
      await joinRoom({ submit: submitDelegate, ruleId: room.ruleId, groupId: room.groupId });
      await new Promise((r) => setTimeout(r, RELAYER_SYNC_MS));
      const msgs = await fetchComments(client, delegate, marketId, me);
      setComments(msgs);
      setGate('joined');
    } catch (e) {
      console.error('[room] join failed', e);
      setError(`Join failed: ${String((e as Error)?.message ?? e).slice(0, 240)}`);
      setGate('joinable');
    }
  }, [marketId, client, delegate, submitAs, me]);

  const post = useCallback(async (text: string) => {
    if (!marketId || !client || !delegate) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(client, delegate, marketId, text);
      const msgs = await fetchComments(client, delegate, marketId, me);
      setComments(msgs);
    } catch (e) {
      console.error('[room] post failed', e);
      setError(`Post failed: ${String((e as Error)?.message ?? e).slice(0, 240)}`);
    } finally {
      setBusy(false);
    }
  }, [marketId, client, delegate, me]);

  return { gate, comments, busy, error, join, post };
}
