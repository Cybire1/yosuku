// Share-card export — "The Call". The moment a bet is placed, this renders a
// portrait 1200×1500 (4:5) PNG of the OPEN, unresolved position — a bold public
// declaration you can drop into a post. It is the live-call sibling of the
// Settlement Receipt's "Earned Heat" (lib/shareCard.ts): same near-black ground,
// same grain + registration ticks + JP hanko language, but the vermilion heat
// here reads as CONVICTION (skin in the game), not a win.
//
// HONESTY (hard rules — do not relax):
//  · This is an OPEN position with NO result. Never imply an outcome. The return
//    is always framed conditionally ("→ WIN", "IF IT LANDS"), never as realized.
//  · Leverage > 1 always carries the "KNOCKOUT BEFORE EXPIRY" caveat.
//  · The settle time is the market's real expiry, shown as an absolute UTC second
//    (stable — never a "settles in ~Xm" that goes stale the moment it's shared).
//  · No fabricated price path. Every number is what the user actually staked.

// ─── the input: one placed call, normalized ───

export interface OpenBetCard {
  kind: 'dir' | 'range';
  dir?: 'up' | 'down';
  strikeUsd?: number;
  lowerUsd?: number;
  higherUsd?: number;
  stakeDusdc: number; // what the user paid
  winDusdc: number; // what a win returns (before knockout when lev > 1)
  lev: number;
  expiryMs: number; // the bell — oracle settlement second
  digest: string; // mint tx digest (the on-chain proof)
  placedAtMs?: number; // when the bet landed — drives the on-screen draining bar (not drawn on the PNG)
}

// ─── layout constants ───

const W = 1200;
const H = 1500;
const SCALE = 2;
const MARGIN = 80;

const FALLBACK_VERMILION = '#E5431F';

const DISPLAY_FALLBACK = "'Sora', system-ui, sans-serif";
const MONO_FALLBACK = "'JetBrains Mono', ui-monospace, monospace";
const JP_FALLBACK = "'Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', serif";

// ─── formatting (exported for the share button's tweet text) ───

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtUsdBound(n: number): string {
  const isInt = Number.isInteger(n);
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: isInt ? 0 : 2,
  });
}

/** The call, human-readable: "BTC UNDER $64,316" / "BTC OVER $64,316" / "BTC $x–$y". */
export function callBandLabel(c: OpenBetCard): string {
  if (c.kind === 'range' && c.lowerUsd != null && c.higherUsd != null) {
    return `BTC ${fmtUsdBound(c.lowerUsd)}–${fmtUsdBound(c.higherUsd)}`;
  }
  if (c.dir === 'up' && c.strikeUsd != null) return `BTC OVER ${fmtUsdBound(c.strikeUsd)}`;
  if (c.dir === 'down' && c.strikeUsd != null) return `BTC UNDER ${fmtUsdBound(c.strikeUsd)}`;
  return 'BTC CALL';
}

/** The direction eyebrow with its glyph: "▲ CALLING UP" etc. */
export function callDirLabel(c: OpenBetCard): string {
  if (c.kind === 'range') return '◆ RANGE CALL';
  return c.dir === 'up' ? '▲ CALLING UP' : '▼ CALLING DOWN';
}

export function fmtLeverage(x: number): string {
  const r = Math.round(x * 10) / 10;
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}×`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Absolute UTC settle second: "15:00:00 UTC". */
export function fmtSettleUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

/** Folio / filename id: first 6 hex of the mint digest, uppercased. */
export function shortCallId(c: OpenBetCard): string {
  return c.digest.replace(/^0x/i, '').slice(0, 6).toUpperCase();
}

function shortDigest(d: string): string {
  return d.length > 12 ? `${d.slice(0, 12)}…` : d;
}

/** Honest pre-filled post text — real staked numbers only, framed as a live call. */
export function buildCallTweetText(c: OpenBetCard): string {
  const band = callBandLabel(c).toLowerCase();
  const lev = c.lev > 1 ? ` (${fmtLeverage(c.lev)})` : '';
  return (
    `My call: ${band}${lev} — ${fmt2(c.stakeDusdc)} to win ${fmt2(c.winDusdc)} DUSDC, ` +
    `oracle-settles ${fmtSettleUtc(c.expiryMs)} on Sui testnet. Will it land? ` +
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
    probe.style.fontFamily = `var(${cssVar}, ${fallback})`;
    probe.textContent = ' ';
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
    /* fall back silently — canvas uses the next family in the stack */
  }
}

// ─── drawing helpers (pure; mirror lib/shareCard.ts) ───

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
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

function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  basePx: number,
  maxWidth: number,
  minPx = 36,
): number {
  ctx.font = `${weight} ${basePx}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w <= maxWidth) return basePx;
  return Math.max(minPx, Math.floor((basePx * maxWidth) / w));
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
    d[i + 3] = Math.random() < 0.5 ? 0 : 14;
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

export async function renderOpenBetShareCard(call: OpenBetCard): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('renderOpenBetShareCard must run in the browser');
  }

  const display = resolveFontFamily('--font-display', DISPLAY_FALLBACK);
  const mono = resolveFontFamily('--font-mono', MONO_FALLBACK);
  const jp = resolveFontFamily('--font-jp', JP_FALLBACK);

  const vermilion = resolveVermilion();
  const [vr, vg, vb] = hexToRgb(vermilion);
  const verm = (a: number) => `rgba(${vr},${vg},${vb},${a})`;

  const band = callBandLabel(call);
  const dirLine = callDirLabel(call);
  const stakeText = fmt2(call.stakeDusdc);
  const winText = fmt2(call.winDusdc);
  const folio = shortCallId(call);

  await Promise.all([
    ensureFont(`800 150px ${display}`, band),
    ensureFont(`800 120px ${display}`, `${stakeText}→${winText}`),
    ensureFont(`800 27px ${display}`, 'YOSUKU'),
    ensureFont(`600 22px ${mono}`),
    ensureFont(`500 26px ${mono}`),
    ensureFont(`700 360px ${jp}`, '賭予'),
  ]);

  const big = document.createElement('canvas');
  big.width = W * SCALE;
  big.height = H * SCALE;
  const ctx = big.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  // ── ground: flat near-black (no vermilion wash — the heat lives only on the
  //    return number and the direction spark) ──
  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, W, H);

  // vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.46)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── ghost 賭 (wager) watermark — depth behind the wager, collision-free ──
  ctx.save();
  ctx.font = `700 380px ${jp}`;
  ctx.fillStyle = 'rgba(255,255,255,0.028)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('賭', W / 2, 800);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';

  // ── registration ticks at the four corners ──
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

  // ── masthead: 予 YOSUKU (left) · N° folio (right) ──
  const mastY = 118;
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

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(MARGIN, 152);
  ctx.lineTo(W - MARGIN, 152);
  ctx.stroke();

  // ── record type ──
  ctx.font = `600 16px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  drawTracked(ctx, 'THE CALL · SUI TESTNET', W / 2, 250, 6, 'center');

  // ── direction eyebrow (vermilion) ──
  ctx.font = `600 30px ${mono}`;
  ctx.fillStyle = vermilion;
  drawTracked(ctx, dirLine.toUpperCase(), W / 2, 360, 4, 'center');

  // ── hero: the call ──
  const heroPx = fitFontPx(ctx, band, display, 800, 132, W - 2 * MARGIN, 60);
  ctx.font = `800 ${heroPx}px ${display}`;
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.textAlign = 'center';
  ctx.fillText(band, W / 2, 486);

  // ── wager: stake → return (return carries the vermilion) ──
  ctx.font = `600 18px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  drawTracked(ctx, 'STAKE  →  RETURN IF IT LANDS', W / 2, 632, 4, 'center');

  // build "1.10 → 1.96" centered, colored in segments
  const wagerPx = 108;
  ctx.font = `800 ${wagerPx}px ${display}`;
  const arrow = '  →  ';
  const wStake = ctx.measureText(stakeText).width;
  const wArrow = ctx.measureText(arrow).width;
  const wWin = ctx.measureText(winText).width;
  const wagerTotal = wStake + wArrow + wWin;
  let wx = W / 2 - wagerTotal / 2;
  const wagerY = 772;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(stakeText, wx, wagerY);
  wx += wStake;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(arrow, wx, wagerY);
  wx += wArrow;
  ctx.save();
  ctx.shadowColor = verm(0.5);
  ctx.shadowBlur = 34 * SCALE;
  ctx.fillStyle = vermilion;
  ctx.fillText(winText, wx, wagerY);
  ctx.restore();
  ctx.fillStyle = vermilion;
  ctx.fillText(winText, wx, wagerY);

  ctx.font = `500 22px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'center';
  drawTracked(ctx, 'DUSDC', W / 2, 824, 5, 'center');

  // ── leverage caveat (only when > 1) ──
  let infoY = 900;
  if (call.lev > 1) {
    ctx.font = `500 20px ${mono}`;
    ctx.fillStyle = verm(0.85);
    ctx.textAlign = 'center';
    ctx.fillText(`${fmtLeverage(call.lev)} LEVERAGE · CAN KNOCK OUT BEFORE THE BELL`, W / 2, infoY);
    infoY += 46;
  }

  // ── settle line (real expiry, absolute UTC) ──
  ctx.font = `400 21px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'center';
  ctx.fillText(`SETTLES ${fmtSettleUtc(call.expiryMs)} · ORACLE-SETTLED AT THE BELL`, W / 2, infoY);

  // ── perforation ──
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 11]);
  ctx.beginPath();
  ctx.moveTo(MARGIN, 1120);
  ctx.lineTo(W - MARGIN, 1120);
  ctx.stroke();
  ctx.restore();

  // ── proof: the real mint digest ──
  ctx.font = `400 19px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.textAlign = 'center';
  ctx.fillText(`MINT ${shortDigest(call.digest)}`, W / 2, 1192);
  ctx.font = `400 15px ${mono}`;
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  drawTracked(ctx, 'VERIFY ON SUISCAN', W / 2, 1234, 4, 'center');

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
  drawTracked(ctx, 'THE BELL · LIVE CALL', W - MARGIN, 1422, 3, 'right');

  // hairline accent under the record — a single vermilion spark at the top edge
  ctx.strokeStyle = verm(0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 26, 172);
  ctx.lineTo(W / 2 + 26, 172);
  ctx.stroke();

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
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
      'image/png',
    );
  });
}
