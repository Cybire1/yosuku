'use client';

import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

interface MarqueeItem {
  label: string;
  value: string;
  direction?: 'up' | 'down' | '';
}

export default function Marquee() {
  const { price, change24h } = useBtcPrice();

  const items: MarqueeItem[] = [
    { label: 'BTC', value: price ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—', direction: change24h && change24h >= 0 ? 'up' : 'down' },
    { label: 'CHAIN', value: 'SUI · TESTNET', direction: '' },
    { label: 'ROUNDS', value: '15-min', direction: '' },
    { label: 'SETTLE', value: 'Oracle', direction: '' },
    { label: 'TOKEN', value: 'DUSDC', direction: '' },
    { label: 'STATUS', value: 'LIVE', direction: 'up' },
  ];

  const renderCells = (keyPrefix: string) =>
    items.map((item, i) => (
      <span key={`${keyPrefix}-${i}`} className="marquee-cell">
        <span className="lbl">{item.label}</span>
        <span className="val">{item.value}</span>
        {item.direction && (
          <span className={item.direction}>{item.direction === 'up' ? '↑' : '↓'}</span>
        )}
      </span>
    ));

  return (
    <div className="marquee">
      <div className="marquee-track">
        {renderCells('a')}
        {renderCells('b')}
        {renderCells('c')}
      </div>
    </div>
  );
}
