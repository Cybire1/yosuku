'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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

export function useBtcPrice() {
  const [data, setData] = useState<BtcPriceData>({
    price: 0,
    change24h: 0,
    high24h: 0,
    low24h: 0,
    timestamp: Date.now(),
  });
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPrice = useRef(0);

  // Fetch initial price via REST (immediate)
  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch(PYTH_REST_URL);
      if (!res.ok) return;
      const json = await res.json();
      const parsed = json.parsed?.[0];
      if (!parsed) return;
      const price = parsePythPrice(parsed);
      if (price > 0) {
        if (firstPrice.current === 0) firstPrice.current = price;
        setData(prev => ({
          ...prev,
          price,
          timestamp: Date.now(),
        }));
      }
    } catch {
      // silent
    }
  }, []);

  // Connect to Pyth SSE stream
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const es = new EventSource(PYTH_SSE_URL);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      es.onmessage = (event) => {
        try {
          const json = JSON.parse(event.data);
          const parsed = json.parsed?.[0];
          if (!parsed) return;
          const price = parsePythPrice(parsed);
          if (price <= 0) return;

          if (firstPrice.current === 0) firstPrice.current = price;
          const change24h = firstPrice.current > 0
            ? ((price - firstPrice.current) / firstPrice.current) * 100
            : 0;

          setData(prev => ({
            price,
            change24h,
            high24h: Math.max(prev.high24h, price),
            low24h: prev.low24h === 0 ? price : Math.min(prev.low24h, price),
            timestamp: Date.now(),
          }));
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        eventSourceRef.current = null;
        // Reconnect after 3s
        reconnectTimer.current = setTimeout(connectSSE, 3000);
      };
    } catch {
      reconnectTimer.current = setTimeout(connectSSE, 3000);
    }
  }, []);

  useEffect(() => {
    // Get initial price immediately via REST
    fetchInitial();
    // Then connect SSE for streaming updates
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [fetchInitial, connectSSE]);

  return { ...data, connected };
}
