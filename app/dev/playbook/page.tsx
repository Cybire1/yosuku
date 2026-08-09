'use client';
// Dev preview for PlaybookVault: the three states side by side, no wallet needed. Never ships.
import PlaybookVault from '@/components/PlaybookVault';

const SID = '0x7ecf2f9e309d30384ce4b737d457ee1057e656b77c7cc1aba1a5e921ab65ae4c';
const BLOB = 'Qm7xKp2vLwR9tYnB4cHdF8sJmXaZeQ3uNgVi';

export default function DevPlaybook() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <main style={{ padding: 24, maxWidth: 640, margin: '0 auto', display: 'grid', gap: 24 }}>
      <div><p style={{ fontSize: 12, opacity: .5, marginBottom: 8 }}>visitor · sealed</p>
        <PlaybookVault strategyId={SID} blobId={BLOB} coinType="0x2::sui::SUI" role="visitor" subFee={2.5} /></div>
      <div><p style={{ fontSize: 12, opacity: .5, marginBottom: 8 }}>subscriber · can open</p>
        <PlaybookVault strategyId={SID} blobId={BLOB} subscriptionId="0xabc" coinType="0x2::sui::SUI" role="subscriber" walletAddress="0x1" signPersonalMessage={async () => ({ signature: '' })} /></div>
      <div><p style={{ fontSize: 12, opacity: .5, marginBottom: 8 }}>creator · nothing sealed</p>
        <PlaybookVault strategyId={SID} coinType="0x2::sui::SUI" role="creator" walletAddress="0x1" /></div>
    </main>
  );
}
