'use client';

// Polling that stops while the tab is hidden.
//
// The app had 85 raw setInterval sites and only ONE visibility-aware timer, which lived privately
// inside lib/sui/hooks.ts (so only the legacy 4-16 hooks benefited). Every 6-24 poller therefore
// ran at full rate in a background tab: a backgrounded /markets burned ~130 RPC round-trips and
// ~5MB per minute indefinitely, which is the most likely source of the 429s we saw.
//
// Use this instead of setInterval for anything that touches the network.

import { useEffect, useRef } from 'react';

/**
 * Non-hook form, for pollers that already live inside a useEffect.
 * Starts an interval that pauses while the tab is hidden and refreshes on return.
 * Returns a stop function. Does NOT run `fn` immediately (callers usually already did).
 */
export function pollWhileVisible(fn: () => void, intervalMs: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const start = () => { if (!id) id = setInterval(fn, intervalMs); };
  const stop = () => { if (id) { clearInterval(id); id = null; } };
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) stop();
    else { fn(); start(); }
  };
  if (typeof document === 'undefined' || !document.hidden) start();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Run `fn` every `intervalMs` while the tab is visible.
 * Pauses on hide, and fires once immediately on return so the UI is never stale on focus.
 *
 * @param fn         the poll body (kept in a ref, so it may close over fresh state)
 * @param intervalMs poll period; pass 0/null to disable
 * @param opts.leading run once on mount (default true)
 */
export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number | null,
  opts?: { leading?: boolean },
): void {
  const saved = useRef(fn);
  saved.current = fn;
  const leading = opts?.leading !== false;

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;
    let id: ReturnType<typeof setInterval> | null = null;

    const tick = () => { void saved.current(); };
    const start = () => { if (!id) id = setInterval(tick, intervalMs); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) stop();
      else { tick(); start(); } // refresh immediately on return, then resume
    };

    if (leading) tick();
    if (typeof document !== 'undefined' && !document.hidden) start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, leading]);
}
