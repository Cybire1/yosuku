import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Yosuku Market';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Match the root card (app/opengraph-image.tsx) — the modern cream design, everywhere.
const CREAM = '#F1EADC';
const INK = '#1A1612';
const MUTE = '#6B6353';
const VERMILION = '#E04D26';
const PROFIT = '#2FA47C';
const LOSS = '#D8556B';

const API_BASE = 'https://predict-server.testnet.mystenlabs.com';
const FLOAT_SCALING = 1_000_000_000;

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let asset = 'BTC';
  let strike = '—';
  let status = 'Active';
  let probability = 50;

  try {
    const res = await fetch(`${API_BASE}/oracles/${id}/state`, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      asset = data.underlying_asset || 'BTC';
      status = data.status === 'settled' ? 'Settled' : 'Active';

      // Nearest strike from forward/spot
      const refPrice = data.forward || data.spot;
      if (refPrice && data.min_strike && data.tick_size) {
        const nearest = Math.round((refPrice - data.min_strike) / data.tick_size) * data.tick_size + data.min_strike;
        strike = `$${(nearest / FLOAT_SCALING).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

        // Rough implied probability (estimate for the preview only)
        const fwd = (data.forward || data.spot) / FLOAT_SCALING;
        const strikeDollars = nearest / FLOAT_SCALING;
        const diff = (fwd - strikeDollars) / (strikeDollars || 1);
        const secsLeft = Math.max(60, (data.expiry - Date.now()) / 1000);
        const sigma = 0.001 * Math.sqrt(secsLeft / 60);
        const z = diff / (sigma || 0.01);
        probability = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-1.7 * z)))));
      }
    }
  } catch { /* use defaults */ }

  const isSettled = status === 'Settled';
  const hasStrike = strike !== '—';
  const yes = probability;
  const no = 100 - yes;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: CREAM,
          fontFamily: 'sans-serif',
          position: 'relative',
          padding: '58px 68px',
        }}
      >
        {/* vermilion editorial rail */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 8, height: '100%', background: VERMILION, display: 'flex' }} />

        {/* top row: wordmark + live/settled pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 27, fontWeight: 800, color: INK, letterSpacing: '0.16em', display: 'flex' }}>YOSUKU</div>
            <div style={{ fontSize: 16, color: VERMILION, letterSpacing: '0.22em', display: 'flex' }}>予測</div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 17px',
              borderRadius: 999,
              background: isSettled ? 'rgba(107,99,83,0.14)' : 'rgba(47,164,124,0.14)',
              border: `1px solid ${isSettled ? 'rgba(107,99,83,0.45)' : 'rgba(47,164,124,0.55)'}`,
            }}
          >
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: isSettled ? MUTE : PROFIT }} />
            <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, letterSpacing: '0.1em', color: isSettled ? MUTE : PROFIT }}>
              {isSettled ? 'SETTLED' : 'LIVE'}
            </div>
          </div>
        </div>

        {/* hero: the market question */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 19, color: MUTE, letterSpacing: '0.14em', marginBottom: 18 }}>
            {asset} · BINARY MARKET
          </div>
          {hasStrike ? (
            <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 78, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.0 }}>
              <div style={{ display: 'flex', color: INK }}>{asset} above</div>
              <div style={{ display: 'flex', color: VERMILION, marginLeft: 22 }}>{strike}?</div>
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 78, fontWeight: 800, letterSpacing: '-0.035em', color: INK }}>
              {asset}: up or down?
            </div>
          )}
        </div>

        {/* odds pills — same green/red language as the root card */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              padding: '22px 30px',
              borderRadius: 18,
              background: 'rgba(47,164,124,0.10)',
              border: '1.5px solid rgba(47,164,124,0.55)',
            }}
          >
            <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: '0.12em', color: PROFIT, marginBottom: 8 }}>UP · YES</div>
            <div style={{ display: 'flex', fontSize: 54, fontWeight: 800, color: PROFIT }}>{yes}¢</div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              padding: '22px 30px',
              borderRadius: 18,
              background: 'rgba(216,85,107,0.10)',
              border: '1.5px solid rgba(216,85,107,0.55)',
            }}
          >
            <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: '0.12em', color: LOSS, marginBottom: 8 }}>DOWN · NO</div>
            <div style={{ display: 'flex', fontSize: 54, fontWeight: 800, color: LOSS }}>{no}¢</div>
          </div>
        </div>

        {/* honest footer — identical to the root card */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 17, color: MUTE, letterSpacing: '0.06em' }}>
            Built on DeepBook Predict · Sui testnet
          </div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: INK }}>yosuku.xyz</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
