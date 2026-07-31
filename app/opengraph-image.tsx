import { ImageResponse } from 'next/og';
import { WIN_PHOTO } from './_og/photo';
import { SORA_400_B64, SORA_800_B64 } from './_og/font';

export const alt = 'Yosuku — bet on Bitcoin from wherever you already are';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Cache the chain read for 15 minutes so the count stays current without paying for a
// chain walk on every preview scrape.
const REVALIDATE = 900;

const CREAM = '#EFE8DC';
const INK = '#141210';
const MUTE = '#635C51';
const FAINT = '#8A8172';
const HAIR = 'rgba(20,18,16,0.14)';
const VERMILION = '#E04D26';

/** Floor shown if the chain read is slow or unavailable — never a number we haven't hit. */
const WALLETS_FLOOR = 168;

const svg = (body: string, vb: string) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`)}`;

// the Yosuku mark — celebrant figure, vermilion heart
const MARK = svg(
  `<g stroke="${INK}" stroke-linecap="round" fill="none">` +
    `<line x1="12" y1="15" x2="88" y2="94" stroke-width="24"/>` +
    `<line x1="254" y1="15" x2="178" y2="94" stroke-width="24"/>` +
    `<line x1="132.5" y1="13" x2="132.5" y2="86" stroke-width="14"/>` +
    `<line x1="132.5" y1="250" x2="132.5" y2="306" stroke-width="14"/></g>` +
    `<rect x="99" y="78" width="67" height="166" rx="16" fill="${INK}"/>` +
    `<circle cx="132.5" cy="239" r="11" fill="${VERMILION}"/>`,
  '0 0 266 322',
);

const I_X = svg(`<path fill="${INK}" d="M18.9 2H22l-7.3 8.3L23.3 22h-6.8l-5.3-6.9L5.1 22H2l7.8-8.9L1.1 2H8l4.8 6.3zM17.7 20.1h1.7L6.9 3.8H5z"/>`, '0 0 24 24');
const I_WEB = svg(`<g fill="none" stroke="${INK}" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.3 9h17.4M3.3 15h17.4"/></g>`, '0 0 24 24');
const I_APP = svg(`<g fill="none" stroke="${INK}" stroke-width="1.6"><rect x="6.6" y="2" width="10.8" height="20" rx="2.8"/><path d="M10.4 5.1h3.2" stroke-linecap="round"/></g>`, '0 0 24 24');
const I_AI = svg(
  `<g fill="none" stroke="${INK}" stroke-width="1.6"><rect x="3.4" y="8" width="17.2" height="12.2" rx="3.4"/><path d="M12 8V4.6" stroke-linecap="round"/></g>` +
    `<circle cx="12" cy="3.4" r="1.4" fill="${INK}"/><circle cx="8.9" cy="14" r="1.2" fill="${INK}"/><circle cx="15.1" cy="14" r="1.2" fill="${INK}"/>`,
  '0 0 24 24',
);

const SURFACES: [string, string, string][] = [
  [I_X, 'On X', 'reply to bet'],
  [I_WEB, 'Web', 'no install'],
  [I_APP, 'iOS / Android', 'native app'],
  [I_AI, 'AI agent', 'via MCP'],
];

const b64ToBuf = (b64: string): ArrayBuffer => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;

/** Live wallet count, with a hard timeout — a slow chain read must never stall a preview. */
async function liveWallets(): Promise<number> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://yosuku.xyz');
  try {
    const r = await fetch(`${base}/api/traction`, { signal: AbortSignal.timeout(2500), next: { revalidate: REVALIDATE } });
    const j = (await r.json()) as { wallets: number | null };
    return typeof j.wallets === 'number' && j.wallets >= WALLETS_FLOOR ? j.wallets : WALLETS_FLOOR;
  } catch {
    return WALLETS_FLOOR;
  }
}

export default async function OGImage() {
  const wallets = await liveWallets();

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: CREAM, fontFamily: 'Sora', position: 'relative' }}>
        {/* editorial rail */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 9, height: '100%', background: VERMILION, display: 'flex' }} />

        {/* ── left: the message ── */}
        <div style={{ width: 712, display: 'flex', flexDirection: 'column', padding: '46px 0 44px 64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK} width={26} height={32} alt="" style={{ display: 'flex' }} />
            <div style={{ display: 'flex', fontSize: 23, fontWeight: 700, color: INK, letterSpacing: '0.15em' }}>YOSUKU</div>
          </div>
          <div style={{ display: 'flex', height: 1, background: HAIR, marginTop: 17 }} />

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 51, fontWeight: 800, letterSpacing: '-0.032em', lineHeight: 1.07, color: INK }}>
              <div style={{ display: 'flex' }}>Bet on Bitcoin from</div>
              <div style={{ display: 'flex' }}>
                wherever you already&nbsp;<span style={{ color: VERMILION }}>are.</span>
              </div>
            </div>
            <div style={{ display: 'flex', marginTop: 16, fontSize: 18.5, color: MUTE }}>Gasless. No seed phrase.</div>
          </div>

          {/* ── distribution ── */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
            <div style={{ display: 'flex', fontSize: 10.5, letterSpacing: '0.22em', color: '#9A9184', marginBottom: 14 }}>BET FROM ANYWHERE</div>
            <div style={{ display: 'flex', gap: 11 }}>
              {SURFACES.map(([icon, title, note]) => (
                <div
                  key={title}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 10, width: 152,
                    padding: '14px 16px', borderRadius: 14, background: 'rgba(20,18,16,0.045)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={icon} width={16} height={16} alt="" style={{ display: 'flex' }} />
                  <div style={{ display: 'flex', fontSize: 15.5, fontWeight: 700, color: INK, letterSpacing: '-0.012em' }}>{title}</div>
                  <div style={{ display: 'flex', fontSize: 12, color: '#847B6E' }}>{note}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', marginTop: 18, fontSize: 15, color: '#7A7266' }}>
              <span style={{ color: INK, fontWeight: 700 }}>{wallets} wallets</span>
              <span>&nbsp;onboarded · verifiable on-chain · Sui testnet</span>
            </div>
          </div>
        </div>

        {/* ── right: the win ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '46px 54px 44px 26px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11, letterSpacing: '0.22em', color: '#9A9184' }}>SUI TESTNET</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 13 }}>
            <div style={{ display: 'flex', borderRadius: 20, overflow: 'hidden' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={WIN_PHOTO} width={410} height={392} alt="" style={{ display: 'flex', objectFit: 'cover' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 10.5, letterSpacing: '0.16em', color: FAINT }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', width: 5, height: 5, borderRadius: 3, background: '#3E9E74', marginRight: 7 }} />
                <span>SETTLED ON-CHAIN</span>
              </div>
              <span>ONLY YOU CASH OUT</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 13, fontSize: 17, fontWeight: 600, color: INK }}>
            yosuku.xyz
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Sora', data: b64ToBuf(SORA_400_B64), weight: 400, style: 'normal' },
        { name: 'Sora', data: b64ToBuf(SORA_800_B64), weight: 800, style: 'normal' },
      ],
    },
  );
}
