'use client';

import { useEffect, useRef } from 'react';

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx, ry = my;
    let dx = mx, dy = my;
    let animId: number;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const tick = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      dx += (mx - dx) * 0.55;
      dy += (my - dy) * 0.55;
      dot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      animId = requestAnimationFrame(tick);
    };

    const onOver = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest?.('[data-cursor]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.cursor === 'up') {
        ring.classList.add('up');
        ring.classList.remove('hover');
      } else if (t.dataset.cursor === 'hover') {
        ring.classList.add('hover');
        ring.classList.remove('up');
      }
    };

    const onOut = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest?.('[data-cursor]') as HTMLElement | null;
      if (!t) return;
      ring.classList.remove('hover', 'up');
    };

    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    animId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
}
