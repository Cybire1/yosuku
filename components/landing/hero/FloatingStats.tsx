'use client';

import { motion } from 'framer-motion';
import { Lock, TrendingUp, Users } from 'lucide-react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

const badgeBase =
  'inline-flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-700/60 bg-zinc-900/70 backdrop-blur-md font-mono text-xs sm:text-sm shadow-lg';

export default function FloatingStats() {
  const { price, change24h } = useBtcPrice();

  const badges = [
    {
      key: 'btc',
      icon: <TrendingUp className="w-3.5 h-3.5 text-[#34D399]" />,
      label: price > 0
        ? `BTC $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : 'BTC ---',
      accent: change24h >= 0 ? 'text-[#34D399]' : 'text-[#F43F5E]',
      sub: price > 0 ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%` : null,
      offsetY: 0,
      delay: 0,
    },
    {
      key: 'preds',
      icon: <Users className="w-3.5 h-3.5 text-[#60A5FA]" />,
      label: '5,555 Predictions',
      accent: 'text-[#60A5FA]',
      sub: null,
      offsetY: 40,
      delay: 0.15,
    },
    {
      key: 'zk',
      icon: <Lock className="w-3.5 h-3.5 text-[#F472B6]" />,
      label: 'Zero-Knowledge',
      accent: 'text-[#F472B6]',
      sub: null,
      offsetY: 80,
      delay: 0.3,
    },
  ];

  return (
    <>
      {badges.map((b, i) => (
        <motion.div
          key={b.key}
          className={`floating-stat absolute hidden md:flex ${badgeBase}`}
          style={{
            right: `${4 + i * 2}%`,
            top: `${28 + b.offsetY * 0.4}%`,
          }}
          initial={{ opacity: 0, x: 20 }}
          animate={{
            opacity: 1,
            x: 0,
            y: [0, -6, 0, 6, 0],
          }}
          transition={{
            opacity: { duration: 0.6, delay: 1.2 + b.delay },
            x: { duration: 0.6, delay: 1.2 + b.delay },
            y: {
              duration: 4 + i * 0.5,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 1.8 + b.delay,
            },
          }}
        >
          {b.icon}
          <span className="text-zinc-200">{b.label}</span>
          {b.sub && (
            <span className={`${b.accent} text-[11px]`}>{b.sub}</span>
          )}
        </motion.div>
      ))}
    </>
  );
}
