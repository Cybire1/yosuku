'use client';

// SettleClock — the branded settlement countdown. Speaks the Bell's ring language (a
// draining arc that empties as the round closes, mono digits, a 締切 accent) so every
// "settles in" moment across the app reads as one system instead of flat gray text.
// Drop-in: pass msLeft (+ optional totalMs for the ring to fill accurately).

const TAU = 2 * Math.PI;

function parts(msLeft: number): { text: string; urgent: boolean; done: boolean } {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  return { text, urgent: s > 0 && s < 60, done: s <= 0 };
}

export function SettleClock({
  msLeft,
  totalMs,
  label = 'Settles in',
  size = 132,
  jp = '締切',
  className = '',
}: {
  msLeft: number | null;
  totalMs?: number;
  label?: string;
  size?: number;
  jp?: string | null;
  className?: string;
}) {
  const ms = msLeft ?? 0;
  const { text, urgent, done } = parts(ms);
  const known = msLeft != null;
  // The drain arc needs a round length to be meaningful; with one we fill precisely, without
  // one we show just the track (the digits still carry the countdown) rather than a stray sliver.
  const hasArc = known && !!totalMs && totalMs > 0;
  const frac = hasArc ? Math.max(0, Math.min(1, ms / (totalMs as number))) : 0;

  const stroke = 3;
  const r = 50 - stroke / 2;
  const circ = TAU * r;
  const accent = urgent || done ? 'var(--vermilion)' : 'var(--white)';
  const timeColor = urgent || done ? 'var(--vermilion)' : 'var(--white)';

  // digits shrink a touch for the h:mm:ss form so they never crowd the ring
  const timeSize = Math.round(size * (text.length > 5 ? 0.17 : 0.225));

  return (
    <div
      className={`settle-clock relative shrink-0 ${urgent ? 'settle-clock--urgent' : ''} ${className}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${label} ${known ? text : 'soon'}`}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90 overflow-visible">
        <circle className="sc-track" cx="50" cy="50" r={r} fill="none" strokeWidth={stroke} />
        {hasArc && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - frac)}
            style={{ transition: 'stroke-dashoffset 900ms linear, stroke 400ms var(--ease)' }}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3px]">
        <span
          className="font-mono uppercase text-gray-500"
          style={{ fontSize: Math.max(7, size * 0.066), letterSpacing: '0.2em' }}
        >
          {label}
        </span>
        <span
          className="font-mono font-semibold tabular-nums leading-none"
          style={{ fontSize: timeSize, color: timeColor, letterSpacing: '-0.02em' }}
        >
          {known ? text : '—'}
        </span>
        {jp && (
          <span className="text-gray-600" style={{ fontFamily: 'var(--font-jp)', fontSize: Math.max(8, size * 0.072) }}>
            {jp}
          </span>
        )}
      </div>
    </div>
  );
}
