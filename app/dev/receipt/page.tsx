'use client';

// DEV-ONLY design-review page for the Trade Receipt — renders the REAL component
// with realistic sample trades so the design can be screenshotted and audited
// before it ever meets a user. Not linked from anywhere; returns nothing in prod.
//   /dev/receipt?state=win|loss|cashout|liq|claimedonly
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TradeReceipt from '@/components/TradeReceipt';
import ShareTradeButton from '@/components/ShareTradeButton';
import type { SettledTrade } from '@/lib/sui/settledTrade';

const BASE = {
  marketId: '0x9cf3b1a25d1c48e6a3f2b7d05a1b2c3d4e5f60718293a4b5c6d7e8f901234ab',
  orderId: '100433623089381612345678901234567890',
  mintDigest: '4tGkP2wVznYr8sJcQmXaTb5eKfHhLdNpRuA9oCiE6gwD',
  redeemDigest: '8uCEo4ZaF7ZGFnGhYSYJo8E7TJem43epEtCxCeLoLd9Y',
  openedAtMs: Date.UTC(2026, 6, 9, 14, 56, 12),
} as const;

const STATES: Record<string, SettledTrade> = {
  win: {
    ...BASE,
    dir: 'up', lowerUsd: 63_000, higherUsd: null,
    stakeMicro: BigInt(2_000_000), qtyMicro: BigInt(4_850_000), leverageX: 2.4,
    payoutMicro: BigInt(4_850_000), pnlMicro: BigInt(2_850_000),
    settlementUsd: 63_142.51, settledAtMs: Date.UTC(2026, 6, 9, 15, 3, 41),
    expiryMs: Date.UTC(2026, 6, 9, 15, 0, 0), kind: 'settled_order_redeemed',
  },
  loss: {
    ...BASE,
    dir: 'down', lowerUsd: null, higherUsd: 62_900,
    stakeMicro: BigInt(2_000_000), qtyMicro: BigInt(4_100_000), leverageX: 1,
    payoutMicro: BigInt(0), pnlMicro: BigInt(-2_000_000),
    settlementUsd: 62_988.22, settledAtMs: Date.UTC(2026, 6, 9, 15, 6, 2),
    expiryMs: Date.UTC(2026, 6, 9, 15, 5, 0), kind: 'settled_order_redeemed',
  },
  cashout: {
    ...BASE,
    dir: 'up', lowerUsd: 62_950, higherUsd: null,
    stakeMicro: BigInt(2_000_000), qtyMicro: BigInt(3_900_000), leverageX: 1.6,
    payoutMicro: BigInt(2_320_000), pnlMicro: BigInt(320_000),
    settlementUsd: 63_071.08, settledAtMs: Date.UTC(2026, 6, 9, 14, 58, 47),
    expiryMs: null, kind: 'live_order_redeemed',
  },
  liq: {
    ...BASE,
    dir: 'up', lowerUsd: 63_200, higherUsd: null,
    stakeMicro: BigInt(2_000_000), qtyMicro: BigInt(5_800_000), leverageX: 2.9,
    payoutMicro: BigInt(0), pnlMicro: BigInt(-2_000_000),
    settlementUsd: 62_901.44, settledAtMs: Date.UTC(2026, 6, 9, 14, 59, 21),
    expiryMs: null, kind: 'liquidated_order_redeemed',
  },
  claimedonly: {
    ...BASE,
    dir: 'range', lowerUsd: 62_800, higherUsd: 63_400,
    stakeMicro: BigInt(2_000_000), qtyMicro: BigInt(3_200_000), leverageX: 1,
    payoutMicro: BigInt(3_200_000), pnlMicro: BigInt(1_200_000),
    settlementUsd: 63_050.75, settledAtMs: Date.UTC(2026, 6, 9, 18, 22, 9),
    expiryMs: null, kind: 'settled_order_redeemed', // no expiry resolved → "Claimed …" fallback
  },
};

function Preview() {
  const state = useSearchParams().get('state') ?? 'win';
  const trade = STATES[state] ?? STATES.win;
  return (
    <main className="min-h-dvh bg-bg">
      <TradeReceipt trade={trade} onClose={() => {}} shareSlot={<ShareTradeButton trade={trade} />} />
    </main>
  );
}

export default function ReceiptPreviewPage() {
  if (process.env.NODE_ENV === 'production') return null; // design-review only
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
