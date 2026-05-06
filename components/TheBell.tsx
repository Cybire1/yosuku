'use client';

import { useState, useEffect } from 'react';

interface TheBellProps {
  targetTime?: number; // epoch ms
  roundDuration?: number; // seconds
}

export default function TheBell({ targetTime, roundDuration = 900 }: TheBellProps) {
  const [secsLeft, setSecsLeft] = useState(0);

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

  const frac = roundDuration > 0 ? secsLeft / roundDuration : 0;
  const dashOffset = (100 - frac * 100).toFixed(2);
  const urgent = secsLeft < 60 && secsLeft > 0;

  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  const s = secsLeft % 60;
  const timeStr = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  return (
    <div className={`bell ${urgent ? 'urgent' : ''}`} data-cursor="hover">
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
