// Chain marks for the deposit sheet.
//
// Drawn rather than emoji or bitmap logos: they inherit size, stay crisp, and add nothing to the
// bundle. Each carries its own brand colour, because a chain picker where every option is the same
// grey is a list of words, and people recognise these marks faster than they read the names.
// Simplified to read at 16px, which is the only size used here.

type Props = { domain: number; size?: number };

export default function ChainIcon({ domain, size = 16 }: Props) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const };

  switch (domain) {
    // Solana — three slanted bars.
    case 5:
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="sol-g" x1="0" y1="24" x2="24" y2="0">
              <stop offset="0" stopColor="#9945FF" />
              <stop offset="1" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <g fill="url(#sol-g)">
            <path d="M6.4 5.2h13a.6.6 0 0 1 .43 1.03l-2.2 2.2a.9.9 0 0 1-.64.27h-13a.6.6 0 0 1-.43-1.03l2.2-2.2a.9.9 0 0 1 .64-.27Z" />
            <path d="M6.4 10.6h13a.6.6 0 0 1 .43 1.03l-2.2 2.2a.9.9 0 0 1-.64.27h-13a.6.6 0 0 1-.43-1.03l2.2-2.2a.9.9 0 0 1 .64-.27Z" />
            <path d="M6.4 16h13a.6.6 0 0 1 .43 1.03l-2.2 2.2a.9.9 0 0 1-.64.27h-13a.6.6 0 0 1-.43-1.03l2.2-2.2a.9.9 0 0 1 .64-.27Z" />
          </g>
        </svg>
      );

    // Avalanche — the A on its red round.
    case 1:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#E84142" />
          <path
            fill="#fff"
            d="M13.9 7.6c.62-1.07 1.62-1.07 2.24 0l2.6 4.5c.62 1.07.12 1.95-1.12 1.95h-5.2c-1.24 0-1.74-.88-1.12-1.95l2.6-4.5Zm-4.3 2.9c.6-1.05 1.55-1.05 2.16 0l.35.6-1.9 3.3c-.35.6-.1 1.1.6 1.1h2.2l-.4.7c-.6 1.05-1.56 1.05-2.16 0l-.9-1.55H7.2c-1.2 0-1.7-.86-1.1-1.9l1.5-2.6c.2-.35.6-.35.8 0l.2-.35Z"
          />
        </svg>
      );

    // Polygon — the interlocking hex mark.
    case 7:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#8247E5" />
          <path
            fill="#fff"
            d="M15.6 9.9c-.26-.15-.6-.15-.88 0l-2 1.16-1.36.77-1.98 1.16c-.27.15-.6.15-.88 0l-1.56-.92a.9.9 0 0 1-.44-.77V9.5c0-.3.15-.6.44-.77l1.54-.9c.26-.15.6-.15.88 0l1.54.92c.27.15.44.46.44.77v1.16l1.36-.8V8.7a.9.9 0 0 0-.44-.77l-2.88-1.7c-.26-.15-.6-.15-.88 0L5.63 7.95a.83.83 0 0 0-.44.77v3.4c0 .3.15.6.44.77l2.9 1.7c.26.15.6.15.88 0l1.98-1.15 1.36-.8 1.98-1.14c.27-.15.6-.15.88 0l1.54.9c.27.15.44.46.44.77v1.8c0 .3-.15.6-.44.77l-1.54.92c-.26.15-.6.15-.88 0l-1.54-.9a.9.9 0 0 1-.44-.77v-1.15l-1.36.8v1.16c0 .3.15.6.44.77l2.9 1.7c.26.15.6.15.87 0l2.9-1.7c.26-.15.43-.46.43-.77v-3.42a.9.9 0 0 0-.44-.77l-2.92-1.72Z"
          />
        </svg>
      );

    // Base — circle with the flat inner edge.
    case 6:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#0052FF" />
          <path
            fill="#fff"
            d="M11.9 19.4c4.1 0 7.44-3.31 7.44-7.4 0-4.09-3.33-7.4-7.44-7.4-3.9 0-7.1 2.99-7.41 6.8h9.8v1.2h-9.8c.31 3.81 3.51 6.8 7.41 6.8Z"
          />
        </svg>
      );

    // Ethereum — the diamond.
    case 0:
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#627EEA" />
          <g fill="#fff">
            <path fillOpacity=".65" d="M12 4.5v5.55l4.7 2.1L12 4.5Z" />
            <path d="M12 4.5 7.3 12.15l4.7-2.1V4.5Z" />
            <path fillOpacity=".65" d="M12 15.98v3.53l4.7-6.5-4.7 2.97Z" />
            <path d="M12 19.51v-3.53L7.3 13.01l4.7 6.5Z" />
            <path fillOpacity=".4" d="M12 15.1l4.7-2.95-4.7-2.1v5.05Z" />
            <path fillOpacity=".85" d="M7.3 12.15 12 15.1v-5.05l-4.7 2.1Z" />
          </g>
        </svg>
      );
  }
}
