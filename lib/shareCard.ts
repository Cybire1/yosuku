// Share-card export — "Social Hero / Earned Heat".
//
// Renders one SettledTrade to a 1200×1500 (4:5) PNG on an offscreen canvas:
// near-black ground, the realized P&L as the giant focal number (win = living
// vermilion heat, loss = drained ash — never green, never red), a rotated kanji
// hanko seal, and an honest record line. ONE-SPARK rule: vermilion appears only
// on a win, and only in the P&L + stamp.
//
// HONESTY (hard rules — do not relax):
//  · kind 'settled_order_redeemed'   → "ORACLE-SETTLED", and the settlement
//    price line is drawn ONLY when settlementUsd is non-null.
//  · kind 'live_order_redeemed'      → "CASHED OUT · LIVE PRICE" (never claims
//    oracle settlement).
//  · kind 'liquidated_order_redeemed'→ "LIQUIDATED", muted.
//  · No fabricated sparkline / price path — every number drawn is a real field
//    from the on-chain join in lib/sui/settledTrade.ts.

import type { SettledTrade } from '@/lib/sui/settledTrade';

// ─── layout constants ───

const W = 1200;
const H = 1500;
const SCALE = 2; // draw @2x, downscale for crisp type
const MARGIN = 80;

const FALLBACK_VERMILION = '#E5431F';
const ASH = '#8f8a82'; // drained loss tone — NOT red
const ASH_DIM = 'rgba(143,138,130,0.55)';

const DISPLAY_FALLBACK = "'Sora', system-ui, sans-serif";
const MONO_FALLBACK = "'JetBrains Mono', ui-monospace, monospace";
const JP_FALLBACK = "'Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', serif";

// ─── formatting helpers (exported for the share button's tweet text) ───

/** micro DUSDC bigint → "1,234.56" (always 2dp, tabular-friendly). */
export function fmtDusdc(micro: bigint): string {
  const n = Number(micro) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Signed P&L string with a typographic minus: "+34.50" / "−12.00". */
export function fmtPnl(pnlMicro: bigint): string {
  const sign = pnlMicro < 0n ? '−' : '+';
  const abs = pnlMicro < 0n ? -pnlMicro : pnlMicro;
  return `${sign}${fmtDusdc(abs)}`;
}

/** USD band bound: integers drop cents ("$97,000"), otherwise 2dp. */
function fmtUsdBound(n: number): string {
  const isInt = Number.isInteger(n);
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: isInt ? 0 : 2,
  });
}

/** Oracle print — always 2dp; a price is a price. */
function fmtUsdPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Human band from real bounds (null = infinite side): OVER $x / UNDER $y / $x–$y. */
export function tradeBandLabel(trade: SettledTrade): string {
  const { lowerUsd, higherUsd } = trade;
  if (lowerUsd != null && higherUsd != null) return `${fmtUsdBound(lowerUsd)}–${fmtUsdBound(higherUsd)}`;
  if (lowerUsd != null) return `OVER ${fmtUsdBound(lowerUsd)}`;
  if (higherUsd != null) return `UNDER ${fmtUsdBound(higherUsd)}`;
  return 'OPEN BAND'; // both infinite should never happen; never invent numbers
}

/** "2.4×" — trims trailing zero; near-1 collapses to "1×". */
export function fmtLeverage(x: number): string {
  const r = Math.round(x * 10) / 10;
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}×`;
}

/** Exact UTC second: "2026-07-08 14:05:00 UTC". */
export function fmtUtcSecond(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** Folio / filename id: first 6 hex chars of the order id, uppercased. */
export function shortOrderId(trade: SettledTrade): string {
  return trade.orderId.replace(/^0x/i, '').slice(0, 6).toUpperCase();
}

function shortDigest(d: string): string {
  return d.length > 10 ? `${d.slice(0, 10)}…` : d;
}

// ─── trade semantics ───

interface TradeLook {
  won: boolean;      // carries the vermilion heat
  kanji: string;     // hanko glyph
  recordType: string;   // masthead record line
  kindLine: string;  // honest settlement/kind line (empty if nothing truthful to say)
  footerKind: string;
}

function tradeLook(trade: SettledTrade): TradeLook {
  const isLiq = trade.kind === 'liquidated_order_redeemed';
  const isLive = trade.kind === 'live_order_redeemed';
  const isSettled = trade.kind === 'settled_order_redeemed';
  const won = !isLiq && trade.pnlMicro > 0n;
  const when = fmtUtcSecond(trade.settledAtMs);

  if (isLiq) {
    return {
      won: false,
      kanji: '切', // 切 — one seal language with the receipt (了 stays generic-redeemed)
      recordType: 'LIQUIDATION RECORD',
      kindLine: `LIQUIDATED · ${when}`,
      footerKind: 'LIQUIDATED',
    };
  }
  if (isLive) {
    return {
      won,
      kanji: '引', // 引
      recordType: 'CASH-OUT RECORD',
      kindLine: `CASHED OUT · LIVE PRICE · ${when}`,
      footerKind: 'CASHED OUT · LIVE PRICE',
    };
  }
  if (isSettled) {
    // The oracle price line exists ONLY here, and only with a real print. The oracle
    // prints AT EXPIRY — settledAtMs is when the CLAIM landed, which can be much later.
    // Only assert a settlement second when we hold the real expiry.
    const kindLine = trade.settlementUsd != null
      ? (trade.expiryMs != null
          ? `ORACLE-SETTLED ${fmtUsdPrice(trade.settlementUsd)} AT ${fmtUtcSecond(trade.expiryMs)}`
          : `ORACLE-SETTLED ${fmtUsdPrice(trade.settlementUsd)} · CLAIMED ${when}`)
      : `SETTLED · CLAIMED ${when}`;
    return {
      won,
      kanji: won ? '勝' : '決', // 勝 / 決
      recordType: 'SETTLEMENT RECORD',
      kindLine,
      footerKind: 'ORACLE-SETTLED',
    };
  }
  // Unknown *_redeemed kind — record it plainly, claim nothing.
  return {
    won,
    kanji: won ? '勝' : '決',
    recordType: 'TRADE RECORD',
    kindLine: `REDEEMED · ${when}`,
    footerKind: 'REDEEMED',
  };
}

/** Honest pre-filled tweet text built from real trade fields only. */
export function buildTradeTweetText(trade: SettledTrade): string {
  const band = tradeBandLabel(trade).toLowerCase();
  const when = fmtUtcSecond(trade.settledAtMs);
  let how: string;
  if (trade.kind === 'settled_order_redeemed') {
    // Assert the oracle's second only when we hold the real expiry (see tradeLook).
    how = trade.settlementUsd != null
      ? (trade.expiryMs != null
          ? `oracle-settled at ${fmtUsdPrice(trade.settlementUsd)}, ${fmtUtcSecond(trade.expiryMs)}`
          : `oracle-settled at ${fmtUsdPrice(trade.settlementUsd)}`)
      : `settled, claimed ${when}`;
  } else if (trade.kind === 'live_order_redeemed') {
    how = `cashed out at live price, ${when}`;
  } else if (trade.kind === 'liquidated_order_redeemed') {
    how = `liquidated, ${when}`;
  } else {
    how = `redeemed ${when}`;
  }
  return (
    `${fmtPnl(trade.pnlMicro)} test USDC on BTC ${band} (${fmtLeverage(trade.leverageX)}) — ${how}. ` +
    `${fmtDusdc(trade.stakeMicro)} → ${fmtDusdc(trade.payoutMicro)} test USDC (Sui testnet). ` +
    `yosuku.xyz @yosuku0`
  );
}

// ─── runtime font resolution (next/font families are hash-named) ───

function resolveFontFamily(cssVar: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  try {
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    // CSS-native fallback: if the var is unset the computed style IS the
    // fallback stack — never the body's inherited (possibly serif) family.
    probe.style.fontFamily = `var(${cssVar}, ${fallback})`;
    probe.textContent = ' ';
    document.body.appendChild(probe);
    const fam = getComputedStyle(probe).fontFamily;
    probe.remove();
    return fam && fam.trim() ? `${fam}, ${fallback}` : fallback;
  } catch {
    return fallback;
  }
}

async function ensureFont(spec: string, sample?: string): Promise<void> {
  try {
    if (typeof document !== 'undefined' && document.fonts?.load) {
      await document.fonts.load(spec, sample);
    }
  } catch {
    // fall back silently — canvas will use the next family in the stack
  }
}

// ─── drawing helpers ───

/** Manual letter-spacing (canvas letterSpacing isn't portable). */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  const chars = Array.from(text);
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + tracking;
  }
  ctx.textAlign = prevAlign;
}

/** Largest px ≤ basePx at which `text` fits maxWidth. */
function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  basePx: number,
  maxWidth: number,
): number {
  ctx.font = `${weight} ${basePx}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w <= maxWidth) return basePx;
  return Math.max(36, Math.floor((basePx * maxWidth) / w));
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Tiny noise tile → film grain pattern (alpha baked in, cheap to tile). */
function makeGrainTile(size = 140): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const x = c.getContext('2d')!;
  const img = x.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = Math.random() < 0.5 ? 0 : 14; // sparse ~5.5% grain
  }
  x.putImageData(img, 0, 0);
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [229, 67, 31];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function resolveVermilion(): string {
  if (typeof document === 'undefined') return FALLBACK_VERMILION;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--vermilion').trim();
    return v || FALLBACK_VERMILION;
  } catch {
    return FALLBACK_VERMILION;
  }
}

// ─── the card ───

export async function renderTradeShareCard(trade: SettledTrade): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('renderTradeShareCard must run in the browser');
  }

  const display = resolveFontFamily('--font-display', DISPLAY_FALLBACK);
  const mono = resolveFontFamily('--font-mono', MONO_FALLBACK);
  const jp = resolveFontFamily('--font-jp', JP_FALLBACK);

  const look = tradeLook(trade);
  const vermilion = resolveVermilion();
  const [vr, vg, vb] = hexToRgb(vermilion);
  const verm = (a: number) => `rgba(${vr},${vg},${vb},${a})`;

  const pnlText = fmtPnl(trade.pnlMicro);
  const subLine = `BTC · ${tradeBandLabel(trade)} · ${fmtLeverage(trade.leverageX)} · ${fmtDusdc(trade.stakeMicro)} → ${fmtDusdc(trade.payoutMicro)} TEST USDC`;
  const folio = shortOrderId(trade);

  await Promise.all([
    ensureFont(`800 240px ${display}`, pnlText),
    ensureFont(`800 34px ${display}`, 'YOSUKU'),
    ensureFont(`600 22px ${mono}`),
    ensureFont(`500 26px ${mono}`, subLine),
    ensureFont(`400 21px ${mono}`),
    ensureFont(`700 108px ${jp}`, '勝決引了予'),
  ]);

  const big = document.createElement('canvas');
  big.width = W * SCALE;
  big.height = H * SCALE;
  const ctx = big.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  // ── ground: near-black with a faint warm bias ──
  ctx.fillStyle = '#070505';
  ctx.fillRect(0, 0, W, H);

  // subtle radial warmth behind the hero — living heat on a win, faint lamp on a loss
  const heat = ctx.createRadialGradient(W / 2, 780, 60, W / 2, 780, 760);
  if (look.won) {
    heat.addColorStop(0, verm(0.14));
    heat.addColorStop(0.55, verm(0.05));
    heat.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    heat.addColorStop(0, 'rgba(255,250,240,0.045)');
    heat.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = heat;
  ctx.fillRect(0, 0, W, H);

  // vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── registration ticks (crosshairs) at the four corners ──
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  const tick = 9;
  for (const [tx, ty] of [[44, 44], [W - 44, 44], [44, H - 44], [W - 44, H - 44]] as const) {
    ctx.beginPath();
    ctx.moveTo(tx - tick, ty);
    ctx.lineTo(tx + tick, ty);
    ctx.moveTo(tx, ty - tick);
    ctx.lineTo(tx, ty + tick);
    ctx.stroke();
  }

  // ── masthead: seal glyph + YOSUKU (left) · folio (right) ──
  const mastY = 118;
  // 予 — the repo's brand glyph. Always neutral: on a win the vermilion heat
  // lives ONLY in the P&L and the stamp (one-spark rule).
  ctx.font = `700 26px ${jp}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('予', MARGIN, mastY);
  ctx.font = `800 27px ${display}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  drawTracked(ctx, 'YOSUKU', MARGIN + 44, mastY - 1, 7, 'left');
  ctx.font = `600 18px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  drawTracked(ctx, `N° ${folio}`, W - MARGIN, mastY - 3, 3, 'right');

  // hairline under masthead
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(MARGIN, 152);
  ctx.lineTo(W - MARGIN, 152);
  ctx.stroke();

  // ── record type ──
  ctx.font = `600 16px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  drawTracked(ctx, look.recordType, W / 2, 258, 6, 'center');

  // ── P&L hero ──
  ctx.font = `600 19px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  drawTracked(ctx, 'REALIZED P&L · TEST USDC', W / 2, 648, 5, 'center');

  const pnlPx = fitFontPx(ctx, pnlText, display, 800, 232, W - 2 * MARGIN);
  ctx.font = `800 ${pnlPx}px ${display}`;
  ctx.textAlign = 'center';
  const pnlY = 872;
  if (look.won) {
    // heat pass — wide soft glow, then a tighter core, then the crisp number
    ctx.save();
    ctx.shadowColor = verm(0.55);
    ctx.shadowBlur = 90 * SCALE;
    ctx.fillStyle = verm(0.9);
    ctx.fillText(pnlText, W / 2, pnlY);
    ctx.shadowBlur = 28 * SCALE;
    ctx.fillText(pnlText, W / 2, pnlY);
    ctx.restore();
    ctx.fillStyle = vermilion;
    ctx.fillText(pnlText, W / 2, pnlY);
  } else {
    ctx.fillStyle = trade.kind === 'liquidated_order_redeemed' ? ASH_DIM : ASH;
    ctx.fillText(pnlText, W / 2, pnlY);
  }

  // ── hanko seal — rotated rounded-rect stamp over the record's upper right ──
  {
    const cx = 952;
    const cy = 636;
    const size = 168;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-8 * Math.PI) / 180);
    ctx.globalAlpha = 0.94;
    const ink = look.won
      ? vermilion
      : trade.kind === 'liquidated_order_redeemed'
        ? ASH_DIM
        : 'rgba(160,155,146,0.8)';
    if (look.won) {
      ctx.shadowColor = verm(0.5);
      ctx.shadowBlur = 26 * SCALE;
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    roundedRectPath(ctx, -size / 2, -size / 2, size, size, 22);
    ctx.stroke();
    ctx.font = `700 104px ${jp}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(look.kanji, 0, 8);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // ── honest sub-line: market · band · leverage · stake→payout ──
  const subPx = fitFontPx(ctx, subLine, mono, 500, 26, W - 2 * MARGIN);
  ctx.font = `500 ${subPx}px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.textAlign = 'center';
  ctx.fillText(subLine, W / 2, 972);

  // ── settlement / kind line (oracle price appears ONLY when truthfully known) ──
  if (look.kindLine) {
    ctx.font = `400 20px ${mono}`;
    ctx.fillStyle =
      trade.kind === 'liquidated_order_redeemed' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.55)';
    const klPx = fitFontPx(ctx, look.kindLine, mono, 400, 20, W - 2 * MARGIN);
    ctx.font = `400 ${klPx}px ${mono}`;
    ctx.fillText(look.kindLine, W / 2, 1026);
  }

  // ── perforation rule ──
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 11]);
  ctx.beginPath();
  ctx.moveTo(MARGIN, 1120);
  ctx.lineTo(W - MARGIN, 1120);
  ctx.stroke();
  ctx.restore();

  // ── verifiable proof block: real tx digests ──
  ctx.font = `400 18px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.textAlign = 'center';
  ctx.fillText(
    `MINT ${shortDigest(trade.mintDigest)} · REDEEM ${shortDigest(trade.redeemDigest)}`,
    W / 2,
    1190,
  );
  ctx.font = `400 15px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  drawTracked(ctx, 'VERIFY ON SUISCAN', W / 2, 1232, 4, 'center');

  // ── footer ──
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(MARGIN, 1372);
  ctx.lineTo(W - MARGIN, 1372);
  ctx.stroke();
  ctx.font = `500 21px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.52)';
  ctx.textAlign = 'left';
  ctx.fillText('yosuku.xyz · @yosuku0', MARGIN, 1424);
  ctx.font = `500 17px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  drawTracked(ctx, look.footerKind, W - MARGIN, 1422, 3, 'right');

  // ── film grain over everything ──
  const grain = makeGrainTile();
  const pattern = ctx.createPattern(grain, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
  }

  // ── downscale to 1200×1500 and encode ──
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('canvas 2d context unavailable');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(big, 0, 0, W, H);

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
      'image/png',
    );
  });
}
