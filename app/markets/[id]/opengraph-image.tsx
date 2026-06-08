import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Yosuku Market';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const API_BASE = 'https://predict-server.testnet.mystenlabs.com';
const FLOAT_SCALING = 1_000_000_000;

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let asset = 'BTC';
  let strike = '—';
  let status = 'Active';
  let probability = '50';

  try {
    const res = await fetch(`${API_BASE}/oracles/${id}/state`, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      asset = data.underlying_asset || 'BTC';
      status = data.status === 'settled' ? 'Settled' : 'Active';

      // Compute nearest strike from forward/spot
      const refPrice = data.forward || data.spot;
      if (refPrice && data.min_strike && data.tick_size) {
        const nearest = Math.round((refPrice - data.min_strike) / data.tick_size) * data.tick_size + data.min_strike;
        strike = `$${(nearest / FLOAT_SCALING).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

        // Quick probability
        const fwd = (data.forward || data.spot) / FLOAT_SCALING;
        const strikeDollars = nearest / FLOAT_SCALING;
        const diff = (fwd - strikeDollars) / (strikeDollars || 1);
        const secsLeft = Math.max(60, (data.expiry - Date.now()) / 1000);
        const sigma = 0.001 * Math.sqrt(secsLeft / 60);
        const z = diff / (sigma || 0.01);
        const prob = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-1.7 * z)))));
        probability = String(prob);
      }
    }
  } catch { /* use defaults */ }

  const isSettled = status === 'Settled';
  const probNum = parseInt(probability);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#050505',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: '#E04D26', display: 'flex' }} />

        {/* Header */}
        <div style={{ position: 'absolute', top: 32, left: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', display: 'flex' }}>YOSUKU</div>
          <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace', display: 'flex' }}>予測</div>
        </div>
        <div style={{ position: 'absolute', top: 32, right: 40, color: isSettled ? '#666' : '#34D399', fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isSettled ? '#666' : '#34D399', display: 'flex' }} />
          {status}
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <div style={{ fontSize: 22, color: '#666', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'monospace', display: 'flex' }}>
            {asset} · Binary
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: '#FFFFFF', display: 'flex' }}>
            {asset} above {strike}?
          </div>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: '#E04D26', display: 'flex' }}>
                {probability}%
              </div>
              <div style={{ fontSize: 16, color: '#666', display: 'flex' }}>YES</div>
            </div>
            <div style={{ width: 1, height: 40, background: '#333', display: 'flex' }} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: '#888', display: 'flex' }}>
                {100 - probNum}%
              </div>
              <div style={{ fontSize: 16, color: '#666', display: 'flex' }}>NO</div>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div style={{ position: 'absolute', bottom: 40, display: 'flex', gap: 24, color: '#444', fontSize: 12, fontFamily: 'monospace' }}>
          <div style={{ display: 'flex' }}>yosuku.xyz</div>
          <div style={{ display: 'flex' }}>Prediction Markets on Sui</div>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '4px', background: '#E04D26', display: 'flex' }} />
      </div>
    ),
    { ...size }
  );
}
