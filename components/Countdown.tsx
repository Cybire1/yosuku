'use client';

import { useState, useEffect } from 'react';
import { getTimeRemaining } from '@/lib/roundHelpers';

interface CountdownProps {
  expiryMs: number;
  className?: string;
  onExpire?: () => void;
}

export default function Countdown({ expiryMs, className = '', onExpire }: CountdownProps) {
  const [time, setTime] = useState(getTimeRemaining(expiryMs));

  useEffect(() => {
    const interval = setInterval(() => {
      const t = getTimeRemaining(expiryMs);
      setTime(t);
      if (t.expired && onExpire) {
        onExpire();
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiryMs, onExpire]);

  if (time.expired) {
    return <span className={`font-mono ${className}`}>Expired</span>;
  }

  const pad = (n: number) => n.toString().padStart(2, '0');

  const isUrgent = time.totalMs < 5 * 60 * 1000;
  const urgentClass = isUrgent ? 'text-orange-400' : '';

  return (
    <span className={`font-mono tabular-nums ${urgentClass} ${className}`}>
      {time.hours > 0 && (
        <>
          <span className="text-white">{pad(time.hours)}</span>
          <span className="text-gray-600 mx-0.5">:</span>
        </>
      )}
      <span className="text-white">{pad(time.minutes)}</span>
      <span className="text-gray-600 mx-0.5">:</span>
      <span className="text-white">{pad(time.seconds)}</span>
    </span>
  );
}
