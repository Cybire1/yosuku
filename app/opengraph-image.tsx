import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Yosuku — Prediction Markets on Sui';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
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
        {/* Vermilion accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '4px',
            background: '#E04D26',
          }}
        />

        {/* Corner marks */}
        <div style={{ position: 'absolute', top: 32, left: 40, color: '#333', fontSize: 11, fontFamily: 'monospace', display: 'flex' }}>
          PLATE OG-01 / YOSUKU
        </div>
        <div style={{ position: 'absolute', top: 32, right: 40, color: '#333', fontSize: 11, fontFamily: 'monospace', display: 'flex' }}>
          SUI · TESTNET · 2026
        </div>

        {/* Main text */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.02em', display: 'flex' }}>
            YOSUKU
          </div>
          <div style={{ fontSize: 14, color: '#666', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'monospace', display: 'flex' }}>
            予測 — Prediction Markets on Sui
          </div>
        </div>

        {/* Bottom info */}
        <div style={{ position: 'absolute', bottom: 40, display: 'flex', gap: 40, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#444', fontFamily: 'monospace', display: 'flex' }}>
            Binary Options · Oracle Settlement · 15-min Rounds
          </div>
        </div>

        {/* Vermilion bottom accent */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '4px',
            background: '#E04D26',
          }}
        />
      </div>
    ),
    { ...size }
  );
}
