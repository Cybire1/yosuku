'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TheBellProps {
  targetTime?: number; // epoch ms
  roundDuration?: number; // seconds
}

const POS_KEY = 'yosuku_bell_pos';
const MARGIN = 12; // keep this far from the viewport edge

export default function TheBell({ targetTime, roundDuration = 900 }: TheBellProps) {
  const [secsLeft, setSecsLeft] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // null = use the CSS default (bottom-right); once dragged we pin fixed left/top.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    function calc() {
      if (targetTime) {
        const left = Math.max(0, Math.floor((targetTime - Date.now()) / 1000));
        setSecsLeft(left);
      }
    }
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [targetTime]);

  const clamp = useCallback((x: number, y: number) => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 76;
    const h = el?.offsetHeight ?? 76;
    return {
      x: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, x)),
      y: Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, y)),
    };
  }, []);

  // Restore saved position, re-clamped to the current viewport.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        setPos(clamp(p.x, p.y));
      }
    } catch { /* ignore */ }
  }, [clamp]);

  // Keep it on-screen across resize / orientation change.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos(p => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    ref.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
    if (d?.moved && pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
    }
  };

  const frac = roundDuration > 0 ? secsLeft / roundDuration : 0;
  const dashOffset = (100 - frac * 100).toFixed(2);
  const urgent = secsLeft < 60 && secsLeft > 0;

  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  const s = secsLeft % 60;
  const timeStr = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  const style = pos
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : undefined;

  return (
    <div
      ref={ref}
      className={`bell ${urgent ? 'urgent' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to reposition"
    >
      <svg viewBox="0 0 100 100">
        <circle className="track" cx="50" cy="50" r="44" pathLength="100" />
        <circle
          className="arc"
          cx="50" cy="50" r="44"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="bell-inner">
        <span className="bell-label">Bell</span>
        <span className="bell-time">{timeStr}</span>
        <span className="bell-jp">締切</span>
      </div>
    </div>
  );
}
