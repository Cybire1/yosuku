'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface BtcPriceData {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';

export function useBtcPrice() {
  const [data, setData] = useState<BtcPriceData>({
    price: 0,
    change24h: 0,
    high24h: 0,
    low24h: 0,
    timestamp: Date.now(),
  });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BINANCE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          setData({
            price: parseFloat(msg.c),       // Current price
            change24h: parseFloat(msg.P),    // Price change percent 24h
            high24h: parseFloat(msg.h),      // High 24h
            low24h: parseFloat(msg.l),       // Low 24h
            timestamp: Date.now(),
          });
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Reconnect on error
      reconnectTimer.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connect]);

  return { ...data, connected };
}
