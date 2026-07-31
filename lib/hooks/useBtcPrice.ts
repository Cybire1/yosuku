'use client';

// Live BTC price from Pyth, shared by every consumer.
//
// This used to open ONE EventSource PER CALL SITE (11 files, and Marquee renders on 16 pages),
// each reconnecting on a fixed 3s timer with no cap. A single upstream hiccup therefore turned
// into ~20 reconnects/minute/client, forever — the app's clearest rate-limit amplifier.
//
// Now: one module-level stream behind a refcount, capped exponential backoff with jitter, and it
// disconnects while the tab is hidden (a background tab has no reason to hold a price socket).

import { useState, useEffect } from 'react';

interface BtcPriceData {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

// Pyth BTC/USD feed ID
const PYTH_BTC_FEED = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const PYTH_SSE_URL = `https://hermes.pyth.network/v2/updates/price/stream?ids[]=${PYTH_BTC_FEED}&parsed=true`;
const PYTH_REST_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_BTC_FEED}&parsed=true`;

function parsePythPrice(parsed: any): number {
  const p = parsed.price;
  return Number(p.price) * Math.pow(10, p.expo);
}

type Snapshot = BtcPriceData & { connected: boolean };

// ─── the single shared stream ───
const EMPTY: Snapshot = { price: 0, change24h: 0, high24h: 0, low24h: 0, timestamp: 0, connected: false };
let snapshot: Snapshot = EMPTY;
let firstPrice = 0;
let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let refs = 0;
const subscribers = new Set<(s: Snapshot) => void>();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const fn of subscribers) fn(snapshot);
}

function applyPrice(price: number) {
  if (!(price > 0)) return;
  if (firstPrice === 0) firstPrice = price;
  publish({
    price,
    change24h: firstPrice > 0 ? ((price - firstPrice) / firstPrice) * 100 : 0,
    high24h: Math.max(snapshot.high24h, price),
    low24h: snapshot.low24h === 0 ? price : Math.min(snapshot.low24h, price),
    timestamp: Date.now(),
  });
}

async function fetchInitial() {
  try {
    const res = await fetch(PYTH_REST_URL);
    if (!res.ok) return;
    const json = await res.json();
    const parsed = json.parsed?.[0];
    if (parsed) applyPrice(parsePythPrice(parsed));
  } catch { /* silent */ }
}

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function disconnect() {
  clearReconnect();
  if (es) { es.close(); es = null; }
  publish({ connected: false });
}

function connect() {
  if (es || typeof window === 'undefined') return;
  if (document.visibilityState === 'hidden') return; // no socket for a background tab
  try {
    const stream = new EventSource(PYTH_SSE_URL);
    es = stream;
    stream.onopen = () => { attempt = 0; clearReconnect(); publish({ connected: true }); };
    stream.onmessage = (e) => {
      try {
        const json = JSON.parse(e.data);
        const parsed = json.parsed?.[0];
        if (parsed) applyPrice(parsePythPrice(parsed));
      } catch { /* ignore parse errors */ }
    };
    stream.onerror = () => {
      stream.close();
      if (es === stream) es = null;
      publish({ connected: false });
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();
  }
}

// capped exponential backoff + jitter: 1s, 2s, 4s … 30s max (was a flat 3s, forever)
function scheduleReconnect() {
  if (reconnectTimer || refs === 0) return;
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  attempt = Math.min(attempt + 1, 5);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, base + Math.random() * 500);
}

function onVisibility() {
  if (refs === 0) return;
  if (document.visibilityState === 'visible') { attempt = 0; void fetchInitial(); connect(); }
  else disconnect();
}

export function useBtcPrice() {
  const [data, setData] = useState<Snapshot>(snapshot);

  useEffect(() => {
    subscribers.add(setData);
    refs += 1;
    if (refs === 1) {
      document.addEventListener('visibilitychange', onVisibility);
      void fetchInitial();
      connect();
    } else {
      setData(snapshot); // late joiner gets the current value immediately
    }
    return () => {
      subscribers.delete(setData);
      refs -= 1;
      if (refs === 0) {
        document.removeEventListener('visibilitychange', onVisibility);
        disconnect();
      }
    };
  }, []);

  return data;
}
