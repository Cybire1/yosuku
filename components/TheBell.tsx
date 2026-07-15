'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TheBellProps {
  targetTime?: number; // epoch ms
  roundDuration?: number; // seconds
  /**
   * A shared clock tick (epoch ms) threaded from the parent page. When provided,
   * the Bell reads the SAME 'now' as the market cards instead of running its own
   * 1s interval — so the two countdowns for one expiry can never drift apart.
   * Omit it and the Bell falls back to its own interval (standalone use).
   */
  now?: number;
}

const POS_KEY = 'yosuku_bell_pos';
const MARGIN = 12; // keep this far from the viewport edge
// Below this scroll depth the market-card list is in view; the Bell collapses to
// a slim edge-docked pill so it never sits on top of the cards' UP/DOWN / Room taps.
const COLLAPSE_AT = 220;

export default function TheBell({ targetTime, roundDuration = 900, now }: TheBellProps) {
  const [secsLeft, setSecsLeft] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // null = use the CSS default (bottom-right); once dragged we pin fixed left/top.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  // Occlusion guard: collapsed once the card list is scrolled into view. `peek`
  // lets a tap re-open the full orb on demand; the next scroll re-collapses it.
  const [collapsed, setCollapsed] = useState(false);
  const [peek, setPeek] = useState(false);

  // ─── countdown: shared tick when threaded, own interval otherwise ───
  useEffect(() => {
    const compute = (clock: number) =>
      targetTime ? Math.max(0, Math.floor((targetTime - clock) / 1000)) : 0;
    if (now != null) {
      // Parent owns the clock — recompute on each threaded tick, no own interval.
      // Guard the pre-hydration `now===0` frame so we never flash a garbage countdown.
      setSecsLeft(compute(now > 0 ? now : Date.now()));
      return;
    }
    const tick = () => setSecsLeft(compute(Date.now()));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [targetTime, now]);

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

  // Collapse to the slim pill while the list is in view; any scroll cancels a peek.
  useEffect(() => {
    const onScroll = () => {
      setCollapsed(window.scrollY > COLLAPSE_AT);
      setPeek(false);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // mini = the non-occluding pill; peeking temporarily restores the full orb.
  const mini = collapsed && !peek;

  const onPointerDown = (e: React.PointerEvent) => {
    if (mini) return; // the pill is edge-docked & tap-to-expand, not draggable
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

  // When docked as the pill we ignore the dragged position and sit in the safe
  // corner slot (CSS default) so it can't drift over a card's controls.
  const style = !mini && pos
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : undefined;

  return (
    <div
      ref={ref}
      className={`bell ${mini ? 'collapsed' : ''} ${urgent ? 'urgent' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={mini ? () => setPeek(true) : undefined}
      role={mini ? 'button' : undefined}
      aria-label={mini ? `Round closes in ${timeStr}. Expand timer.` : undefined}
      title={mini ? 'Tap to expand' : 'Drag to reposition'}
    >
      {mini ? (
        <>
          <span className="bell-ring" aria-hidden>
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
          </span>
          <span className="bell-mini-txt">
            <span className="bell-label">Next close</span>
            <span className="bell-time">{timeStr}</span>
          </span>
        </>
      ) : (
        <>
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
            <span className="bell-label">Close</span>
            <span className="bell-time">{timeStr}</span>
            <span className="bell-jp">締切</span>
          </div>
        </>
      )}
    </div>
  );
}
