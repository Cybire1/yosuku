'use client';

// useCommentRoom — drives The Room's gate state machine from the connected wallet.
//
//   connect  no wallet
//   locked   wallet, but no bet on this market (can't talk)
//   joinable has a bet, not yet a room member → one sig to join
//   joining  join tx in flight (create-or-find room, then gated join)
//   joined   member: thread + composer, polled live
//
// All execution is the app's gRPC path; reads/decrypt run through Seal + our relayer.
// The messaging client is built ONCE per session (its Seal SessionKey = one wallet
// personal-message prompt) and reused across probe/join/post/poll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount, useSignTransaction } from '@mysten/dapp-kit';
import { useWalletSigner } from './useWalletSigner';
import { useSmartSubmit } from './useSmartSubmit';
import {
  getMessagingClient,
  findMarketRoom,
  ensureMarketRoom,
  joinRoom,
  postComment,
  fetchComments,
  checkHasBet,
} from './comments';
import type { RoomComment, RoomGate } from '@/components/CommentRoom';

const RELAYER_SYNC_MS = 14_000; // let the relayer see the on-chain permission grant
const POLL_MS = 9_000;

export interface UseCommentRoom {
  gate: RoomGate;
  comments: RoomComment[];
  busy: boolean;
  join: () => Promise<void>;
  post: (text: string) => Promise<void>;
}

export function useCommentRoom(marketId: string | null, open: boolean): UseCommentRoom {
  const account = useCurrentAccount();
  const signer = useWalletSigner();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { submit } = useSmartSubmit(); // join is gas-free via Onara (wallet fallback)
  // one client per session → one SessionKey prompt (see file header).
  const client = useMemo(() => (signer ? getMessagingClient(signer) : null), [signer]);

  const [gate, setGate] = useState<RoomGate>('connect');
  const [comments, setComments] = useState<RoomComment[]>([]);
  const [busy, setBusy] = useState(false);
  const roomRef = useRef<{ ruleId: string; groupId: string } | null>(null);
  const me = account?.address;

  // reset room refs + thread when the market changes.
  useEffect(() => {
    roomRef.current = null;
    setComments([]);
  }, [marketId]);

  // resolve the gate whenever opened / wallet changes.
  useEffect(() => {
    if (!open || !marketId) return;
    if (!account || !signer || !client) { setGate('connect'); return; }
    let cancelled = false;
    (async () => {
      const hasBet = await checkHasBet(account.address, marketId);
      if (cancelled) return;
      if (!hasBet) { setGate('locked'); return; }
      // has a position — if a room exists, probe membership by reading it.
      const room = await findMarketRoom(marketId);
      if (cancelled) return;
      if (room) {
        roomRef.current = room;
        try {
          const msgs = await fetchComments(client, signer, marketId, me);
          if (cancelled) return;
          setComments(msgs);
          setGate('joined');
          return;
        } catch {
          // room exists but we're not a member yet → joinable
        }
      }
      if (!cancelled) setGate('joinable');
    })();
    return () => { cancelled = true; };
  }, [open, marketId, account, signer, client, me]);

  // poll the thread while joined.
  useEffect(() => {
    if (gate !== 'joined' || !open || !marketId || !client || !signer) return;
    let stop = false;
    const id = setInterval(async () => {
      try {
        const msgs = await fetchComments(client, signer, marketId, me);
        if (!stop) setComments(msgs);
      } catch { /* transient relayer/read hiccup — next tick retries */ }
    }, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [gate, open, marketId, client, signer, me]);

  const join = useCallback(async () => {
    if (!marketId || !client || !signer) return;
    setGate('joining');
    try {
      const room = await ensureMarketRoom({ client, signer, signTransaction, marketId });
      roomRef.current = room;
      await joinRoom({ submit, ruleId: room.ruleId, groupId: room.groupId });
      await new Promise((r) => setTimeout(r, RELAYER_SYNC_MS));
      const msgs = await fetchComments(client, signer, marketId, me);
      setComments(msgs);
      setGate('joined');
    } catch (e) {
      console.error('[room] join failed', e);
      setGate('joinable');
    }
  }, [marketId, client, signer, signTransaction, me]);

  const post = useCallback(async (text: string) => {
    if (!marketId || !client || !signer) return;
    setBusy(true);
    try {
      await postComment(client, signer, marketId, text);
      const msgs = await fetchComments(client, signer, marketId, me);
      setComments(msgs);
    } catch (e) {
      console.error('[room] post failed', e);
    } finally {
      setBusy(false);
    }
  }, [marketId, client, signer, me]);

  return { gate, comments, busy, join, post };
}
