'use client';

const LEFT_WORDS = [
  { text: 'gm', rotate: -12, top: 4, left: 40, size: 28, opacity: 0.14, color: '#fff' },
  { text: 'HODL', rotate: 5, top: 10, left: 24, size: 11, opacity: 0.2, color: '#34D399' },
  { text: 'diamond hands', rotate: -3, top: 14, left: 50, size: 13, opacity: 0.1, color: '#fff' },
  { text: 'buy the', rotate: -4, top: 20, left: 35, size: 15, opacity: 0.1, color: '#fff' },
  { text: 'dip ↓', rotate: -2, top: 24, left: 55, size: 22, opacity: 0.16, color: '#34D399' },
  { text: 'ser', rotate: 8, top: 29, left: 28, size: 20, opacity: 0.09, color: '#fff' },
  { text: '☀', rotate: 3, top: 33, left: 60, size: 10, opacity: 0.12, color: '#fff' },
  { text: 'up only', rotate: -6, top: 37, left: 30, size: 16, opacity: 0.13, color: '#34D399' },
  { text: 'wagmi', rotate: -7, top: 42, left: 48, size: 24, opacity: 0.08, color: '#fff' },
  { text: 'few', rotate: 9, top: 47, left: 26, size: 12, opacity: 0.16, color: '#60A5FA' },
  { text: 'all in', rotate: 6, top: 51, left: 55, size: 13, opacity: 0.18, color: '#F43F5E' },
  { text: 'rekt', rotate: -4, top: 55, left: 32, size: 11, opacity: 0.1, color: '#F43F5E' },
  { text: '↗ moon', rotate: -3, top: 59, left: 42, size: 18, opacity: 0.12, color: '#34D399' },
  { text: '1 BTC', rotate: 4, top: 64, left: 28, size: 10, opacity: 0.15, color: '#fff' },
  { text: '= 1 BTC', rotate: 3, top: 67, left: 36, size: 10, opacity: 0.15, color: '#fff' },
  { text: 'stack sats', rotate: -5, top: 71, left: 50, size: 14, opacity: 0.11, color: '#34D399' },
  { text: 'lfg', rotate: -9, top: 76, left: 38, size: 32, opacity: 0.07, color: '#34D399' },
  { text: '🎯', rotate: 2, top: 75, left: 24, size: 12, opacity: 0.14, color: '#fff' },
  { text: 'anon', rotate: 5, top: 81, left: 55, size: 15, opacity: 0.09, color: '#60A5FA' },
  { text: 'ngmi?', rotate: 7, top: 85, left: 30, size: 14, opacity: 0.12, color: '#F43F5E' },
  { text: 'wen lambo', rotate: -6, top: 90, left: 42, size: 12, opacity: 0.13, color: '#fff' },
  { text: 'gn 🌙', rotate: 4, top: 95, left: 34, size: 18, opacity: 0.1, color: '#60A5FA' },
];

const RIGHT_WORDS = [
  { text: 'degen', rotate: 10, top: 5, right: 75, size: 22, opacity: 0.12, color: '#fff' },
  { text: 'NFA', rotate: -4, top: 11, right: 90, size: 11, opacity: 0.18, color: '#F43F5E' },
  { text: 'bullish', rotate: 6, top: 16, right: 68, size: 16, opacity: 0.14, color: '#34D399' },
  { text: 'DYOR', rotate: -8, top: 22, right: 85, size: 12, opacity: 0.16, color: '#60A5FA' },
  { text: 'send it', rotate: 3, top: 27, right: 72, size: 20, opacity: 0.1, color: '#fff' },
  { text: '📈', rotate: -2, top: 32, right: 95, size: 14, opacity: 0.13, color: '#fff' },
  { text: 'alpha', rotate: 7, top: 37, right: 65, size: 18, opacity: 0.09, color: '#34D399' },
  { text: 'no cap', rotate: -5, top: 42, right: 82, size: 13, opacity: 0.15, color: '#fff' },
  { text: 'ape in', rotate: 9, top: 48, right: 70, size: 26, opacity: 0.08, color: '#34D399' },
  { text: 'fomo', rotate: -7, top: 53, right: 88, size: 14, opacity: 0.14, color: '#F43F5E' },
  { text: 'probably', rotate: 4, top: 58, right: 74, size: 12, opacity: 0.11, color: '#fff' },
  { text: 'nothing', rotate: 3, top: 61, right: 80, size: 12, opacity: 0.11, color: '#fff' },
  { text: 'cope', rotate: -10, top: 66, right: 92, size: 15, opacity: 0.1, color: '#F43F5E' },
  { text: 'bearish?', rotate: 5, top: 71, right: 68, size: 11, opacity: 0.16, color: '#F43F5E' },
  { text: 'frens', rotate: -3, top: 76, right: 84, size: 20, opacity: 0.09, color: '#60A5FA' },
  { text: 'giga', rotate: 8, top: 81, right: 72, size: 30, opacity: 0.06, color: '#34D399' },
  { text: '💎🙌', rotate: -6, top: 86, right: 90, size: 12, opacity: 0.14, color: '#fff' },
  { text: 'iykyk', rotate: 4, top: 91, right: 76, size: 16, opacity: 0.12, color: '#fff' },
  { text: 'based', rotate: -8, top: 96, right: 82, size: 14, opacity: 0.15, color: '#60A5FA' },
];

export default function DoodleStrip() {
  return (
    <>
      {/* Left gutter */}
      <div
        className="fixed left-0 top-0 w-44 h-screen z-10 pointer-events-none select-none hidden xl:block"
        aria-hidden
      >
        {LEFT_WORDS.map((w, i) => (
          <span
            key={i}
            className="absolute font-hand italic whitespace-nowrap"
            style={{
              top: `${w.top}%`,
              left: `${w.left}px`,
              fontSize: `${w.size}px`,
              opacity: w.opacity,
              color: w.color,
              transform: `rotate(${w.rotate}deg)`,
            }}
          >
            {w.text}
          </span>
        ))}
      </div>

      {/* Right gutter */}
      <div
        className="fixed right-0 top-0 w-44 h-screen z-10 pointer-events-none select-none hidden xl:block"
        aria-hidden
      >
        {RIGHT_WORDS.map((w, i) => (
          <span
            key={i}
            className="absolute font-hand italic whitespace-nowrap"
            style={{
              top: `${w.top}%`,
              right: `${w.right}px`,
              fontSize: `${w.size}px`,
              opacity: w.opacity,
              color: w.color,
              transform: `rotate(${w.rotate}deg)`,
            }}
          >
            {w.text}
          </span>
        ))}
      </div>
    </>
  );
}
