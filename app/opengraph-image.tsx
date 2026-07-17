import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Yosuku — Prediction Markets on Sui';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CREAM = '#F1EADC';
const INK = '#1A1612';
const MUTE = '#6B6353';
const VERMILION = '#E04D26';
const PROFIT = '#2FA47C';
const LOSS = '#D8556B';

// the Yosuku mark (celebrant figure), as a data-URI so next/og rasterizes it cleanly
const markSrc = (figure: string, dot: string) =>
  `data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 266 322">` +
      `<g stroke="${figure}" stroke-linecap="round" fill="none">` +
      `<line x1="12" y1="15" x2="88" y2="94" stroke-width="24"/>` +
      `<line x1="254" y1="15" x2="178" y2="94" stroke-width="24"/>` +
      `<line x1="132.5" y1="13" x2="132.5" y2="86" stroke-width="14"/>` +
      `<line x1="132.5" y1="250" x2="132.5" y2="306" stroke-width="14"/></g>` +
      `<rect x="99" y="78" width="67" height="166" rx="16" fill="${figure}"/>` +
      `<circle cx="132.5" cy="239" r="11" fill="${dot}"/></svg>`,
  )}`;

export default function OGImage() {
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

        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markSrc(INK, VERMILION)} width={30} height={36} alt="" style={{ display: 'flex' }} />
          <div style={{ fontSize: 27, fontWeight: 800, color: INK, letterSpacing: '0.16em', display: 'flex' }}>YOSUKU</div>
          <div style={{ fontSize: 16, color: VERMILION, letterSpacing: '0.22em', display: 'flex' }}>予測</div>
        </div>

        {/* hero row: headline (left) + live-market card (right) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 600 }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 72, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.0 }}>
              <div style={{ display: 'flex', color: INK }}>Bet on Bitcoin.</div>
              <div style={{ display: 'flex', color: VERMILION }}>Keep your money.</div>
            </div>
            <div style={{ display: 'flex', marginTop: 28, fontSize: 21, color: MUTE, letterSpacing: '-0.01em' }}>
              Gasless · no seed phrase · self-custody · on Sui
            </div>
          </div>

          {/* live-market card — dark, to pop off the cream */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 388,
              padding: '30px 32px',
              borderRadius: 22,
              background: INK,
              border: '1px solid rgba(26,22,18,0.9)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 20 }}>
              <div style={{ display: 'flex', width: 42, height: 42, borderRadius: 21, background: '#F7931A', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#fff' }}>
                B
              </div>
              <div style={{ display: 'flex', fontSize: 15, color: '#b8b0a4', letterSpacing: '0.1em' }}>BTC · 5-MINUTE</div>
            </div>
            <div style={{ display: 'flex', fontSize: 27, fontWeight: 800, color: CREAM, marginBottom: 24, lineHeight: 1.12 }}>
              holds above $64,800?
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '15px 0', borderRadius: 12, background: 'rgba(47,164,124,0.12)', border: `1px solid rgba(47,164,124,0.5)`, color: PROFIT, fontSize: 19, fontWeight: 700 }}>
                UP 64¢
              </div>
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '15px 0', borderRadius: 12, background: 'rgba(216,85,107,0.12)', border: `1px solid rgba(216,85,107,0.5)`, color: LOSS, fontSize: 19, fontWeight: 700 }}>
                DOWN 36¢
              </div>
            </div>
          </div>
        </div>

        {/* honest footer */}
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
