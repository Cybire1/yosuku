/**
 * Yosuku Canvas Chart System
 * Candlestick, area, and sparkline rendering for prediction market charts.
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  /** No price pushed in this bucket — value carried forward from the previous candle. */
  flat?: boolean;
}

export interface DrawOptions {
  strike?: number | null;
  maxCandleW?: number;
  gridLines?: boolean;
  marker?: boolean;
  padX?: number;
  padTop?: number;
  padBot?: number;
}

// ─── Convert PriceData[] into Candle[] ───
export function priceHistoryToCandles(
  history: { spot: number; timestamp: number }[],
  bucketCount = 30,
): Candle[] {
  if (history.length === 0) return [];
  // Sort ascending by timestamp
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const tMin = sorted[0].timestamp;
  const tMax = sorted[sorted.length - 1].timestamp;
  const tRange = tMax - tMin || 1;
  const bucketSize = tRange / bucketCount;

  const candles: Candle[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = tMin + i * bucketSize;
    const hi = lo + bucketSize;
    const pts = sorted.filter(p => p.timestamp >= lo && (i === bucketCount - 1 ? p.timestamp <= hi : p.timestamp < hi));
    if (pts.length === 0) {
      // carry forward from previous candle
      if (candles.length > 0) {
        const prev = candles[candles.length - 1];
        candles.push({ open: prev.close, high: prev.close, low: prev.close, close: prev.close, flat: true });
      }
      continue;
    }
    const open = pts[0].spot;
    const close = pts[pts.length - 1].spot;
    const high = Math.max(...pts.map(p => p.spot));
    const low = Math.min(...pts.map(p => p.spot));
    candles.push({ open, high, low, close });
  }
  return candles;
}

// ─── Deterministic candle generation ───
export function genCandles(
  seed: number,
  count: number,
  start: number,
  end: number,
  volatility: number
): Candle[] {
  let s = seed * 9301 + 49297;
  const rng = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  const candles: Candle[] = [];
  let price = start;

  for (let i = 0; i < count; i++) {
    const bias = (i / count) * (end - start) / count * 1.1;
    const mv = (rng() - 0.5) * volatility + bias;
    const open = price;
    const close = price + mv;
    const high = Math.max(open, close) + rng() * volatility * 0.5;
    const low = Math.min(open, close) - rng() * volatility * 0.5;
    candles.push({ open, high, low, close });
    price = close;
  }

  // Force last candle to end at target
  if (candles.length) {
    const last = candles[candles.length - 1];
    last.close = end;
    last.high = Math.max(last.high, end);
    last.low = Math.min(last.low, end);
  }

  return candles;
}

// ─── Canvas setup with DPR handling ───
export function setupCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const nextW = Math.max(1, Math.round(r.width * dpr));
  const nextH = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

// ─── Draw candlestick chart ───
export function drawCandles(
  canvas: HTMLCanvasElement | null,
  candles: Candle[],
  opts: DrawOptions = {}
): void {
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!candles.length) return;

  const padX = opts.padX ?? 8;
  const padTop = opts.padTop ?? 8;
  const padBot = opts.padBot ?? 8;

  let lo = Infinity;
  let hi = -Infinity;
  candles.forEach(c => {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  });
  if (opts.strike != null) {
    lo = Math.min(lo, opts.strike);
    hi = Math.max(hi, opts.strike);
  }

  const range = (hi - lo) || 1;
  const yScale = (h - padTop - padBot) / range;
  const innerW = w - padX * 2;
  // Bodies fill ~3/4 of their slot so candles read as a contiguous tape,
  // not confetti — terminal convention.
  const candleW = Math.max(2, Math.min(opts.maxCandleW || 8, innerW / candles.length * 0.75));
  const stride = innerW / candles.length;
  const yFor = (price: number) => padTop + (hi - price) * yScale;

  // Grid lines
  if (opts.gridLines) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = padTop + (h - padTop - padBot) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // Strike line
  if (opts.strike != null) {
    const y = yFor(opts.strike);
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 77, 38, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();
  }

  // Candle bodies and wicks
  candles.forEach((c, i) => {
    const x = padX + i * stride + stride / 2;

    // Quiet bucket (no push, or a single sample): a neutral doji dash — the
    // price held here, it didn't go green and it didn't vanish.
    if (c.flat || c.high === c.low) {
      ctx.fillStyle = 'rgba(163, 163, 163, 0.55)';
      ctx.fillRect(x - candleW / 2, yFor(c.close) - 1, candleW, 2);
      return;
    }

    const isUp = c.close >= c.open;
    // Direction pair (founder call): light green/red — trader convention.
    // Vermilion stays reserved for the strike line.
    const color = isUp ? 'rgba(52, 211, 153, 0.95)' : 'rgba(251, 113, 133, 0.95)';
    const fillC = isUp ? 'rgba(52, 211, 153, 0.9)' : 'rgba(251, 113, 133, 0.85)';

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, yFor(c.high));
    ctx.lineTo(x, yFor(c.low));
    ctx.stroke();

    // Body
    const yo = yFor(c.open);
    const yc = yFor(c.close);
    const top = Math.min(yo, yc);
    const bh = Math.max(1, Math.abs(yc - yo));
    ctx.fillStyle = fillC;
    ctx.fillRect(x - candleW / 2, top, candleW, bh);
  });

  // Current price marker
  if (opts.marker && candles.length) {
    const last = candles[candles.length - 1];
    const x = padX + (candles.length - 0.5) * stride;
    const y = yFor(last.close);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Pulse ring
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ─── helpers for the price-line renderer ───
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Theme-aware ink ───
// A canvas can't inherit CSS, so gridlines/labels were hardcoded white and
// vanished on the cream light theme. We can't just read the global data-theme:
// the feed reel keeps a DARK card even in light mode, so its labels must stay
// light. Instead we read each canvas's *own* surface luminance (walking
// ancestors, gradient stops included) and pick ink to match. Cached per canvas
// and re-resolved only when the global theme flips, so the rAF-driven charts
// don't recompute styles every frame.
type ChartInk = { grid: string; axisLabel: string; xLabel: string; targetLine: string };
const DARK_INK: ChartInk = {
  grid: 'rgba(255,255,255,0.05)',
  axisLabel: 'rgba(255,255,255,0.3)',
  xLabel: 'rgba(255,255,255,0.28)',
  targetLine: 'rgba(255,255,255,0.32)',
};
const LIGHT_INK: ChartInk = {
  grid: 'rgba(20,18,16,0.08)',
  axisLabel: 'rgba(20,18,16,0.5)',
  xLabel: 'rgba(20,18,16,0.46)',
  targetLine: 'rgba(20,18,16,0.4)',
};
// Equity curve carries its own palette (line/rules/baseline/labels).
type EquityInk = { rule: string; zero: string; line: string; label: string };
const DARK_EQ: EquityInk = {
  rule: 'rgba(255,255,255,0.06)',
  zero: 'rgba(255,255,255,0.26)',
  line: 'rgba(255,255,255,0.92)',
  label: 'rgba(255,255,255,0.4)',
};
const LIGHT_EQ: EquityInk = {
  rule: 'rgba(201,191,166,0.4)',
  zero: 'rgba(26,22,18,0.35)',
  line: '#1A1612',
  label: '#6B6353',
};

function colorLuma(str: string): { luma: number; alpha: number } | null {
  const m = str.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const [r, g, b] = p;
    const a = p.length >= 4 && !Number.isNaN(p[3]) ? p[3] : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, alpha: a };
  }
  const hx = str.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hx) {
    let hex = hx[1];
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, alpha: 1 };
  }
  return null;
}

function surfaceIsLight(canvas: HTMLCanvasElement): boolean {
  if (typeof window === 'undefined') return false;
  let el: HTMLElement | null = canvas;
  let guard = 0;
  while (el && guard++ < 24) {
    const cs = getComputedStyle(el);
    const bc = colorLuma(cs.backgroundColor);
    if (bc && bc.alpha >= 0.5) return bc.luma > 140;
    const bi = cs.backgroundImage;
    if (bi && bi !== 'none' && /gradient/i.test(bi)) {
      const stops = bi.match(/rgba?\([^)]+\)/gi) || [];
      let sum = 0, n = 0;
      for (const s of stops) {
        const p = colorLuma(s);
        if (p && p.alpha >= 0.5) { sum += p.luma; n++; }
      }
      if (n > 0) return sum / n > 140;
    }
    el = el.parentElement;
  }
  return false; // default: dark surface
}

const surfaceCache = new WeakMap<HTMLCanvasElement, { key: string; light: boolean }>();
function chartSurfaceLight(canvas: HTMLCanvasElement): boolean {
  const key = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme') || 'dark'
    : 'dark';
  const cached = surfaceCache.get(canvas);
  if (cached && cached.key === key) return cached.light;
  const light = surfaceIsLight(canvas);
  surfaceCache.set(canvas, { key, light });
  return light;
}

// ─── UP-vs-DOWN stick duel that roams the live price line ───
// Two small line-fighters roam the FULL width of the chart, riding the price line
// as terrain: they drift apart to both ends, close to clash, and knock each other
// back. Whoever's winning the market (price above / below the UP line) presses.
const DUEL_UP = '#57D39A', DUEL_DOWN = '#F0584A';
const dmix = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dsmooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (e0 - x) / (e0 - e1))); return t * t * (3 - 2 * t); };
function drawStick(
  ctx: CanvasRenderingContext2D, cx: number, feetY: number,
  p: { face: number; rot: number; punch: number; kick: number; bob: number; scale: number; color: string },
) {
  const { face, rot, punch, kick, bob, scale, color } = p;
  let lEl = dmix([face * 8, -46], [face * 22, -45], punch), lHa = dmix([face * 13, -55], [face * 49, -46], punch);
  let rEl = [face * -9, -50], rHa = [face * 4, -58];
  const wv = 1 - punch, bY = bob * 4 * wv, bX = bob * 2.4 * face * wv;
  lEl = [lEl[0] + bX, lEl[1] + bY]; lHa = [lHa[0] + bX, lHa[1] + bY];
  rEl = [rEl[0] - bX, rEl[1] - bY * 1.3]; rHa = [rHa[0] - bX, rHa[1] - bY * 1.3];
  const lKn = dmix([face * 9, 22], [face * 27, 4], kick), lFo = dmix([face * 13, 46], [face * 53, -3], kick);
  const rKn = [face * -11, 22], rFo = [face * -18, 46];
  ctx.save();
  ctx.translate(cx, feetY - 46 * scale);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (a: number[], b: number[], c?: number[]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); if (c) ctx.lineTo(c[0], c[1]); ctx.stroke(); };
  seg([0, 0], rKn, rFo);
  seg([0, 0], lKn, lFo);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -46); ctx.stroke();
  seg([0, -42], rEl, rHa);
  seg([0, -42], lEl, lHa);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -61, 13, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawDuelBurst(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const grow = 5 + a * 9;
  for (const d of [30, 90, 150, 210, 270, 330]) {
    const r = (d * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(r) * grow * 0.5, y + Math.sin(r) * grow * 0.5);
    ctx.lineTo(x + Math.cos(r) * grow, y + Math.sin(r) * grow);
    ctx.stroke();
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 3 * a, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
export function drawDuel(
  ctx: CanvasRenderingContext2D,
  o: { yAtX: (x: number) => number; xMin: number; xMax: number; h: number; now: number; above: boolean },
) {
  const { yAtX, xMin, xMax, h, now, above } = o;
  const span = xMax - xMin;
  if (span < 120) return;
  const f = now / 16.667;
  const wf = Math.min(1, span / 800); // wide (desktop) → full size; narrow (mobile) → much smaller
  const scale = Math.max(0.13, Math.min(0.28, 0.06 + 0.22 * wf));
  const mid = (xMin + xMax) / 2, A = span * 0.44;
  // roam the full width; slightly different frequencies → they meet at varied spots
  const upX0 = mid + A * Math.sin(f * 0.016 + 0.4);
  const dnX0 = mid + A * Math.sin(f * 0.0193 + 3.4);
  const clash = dsmooth(84, 22, Math.abs(dnX0 - upX0)); // 0 apart → 1 clashing
  const build = (who: 'UP' | 'DOWN') => {
    const isUp = who === 'UP';
    const baseX = isUp ? upX0 : dnX0;
    const oppX = isUp ? dnX0 : upX0;
    const face = oppX >= baseX ? 1 : -1;
    const isAggr = isUp === above;
    const phase = isUp ? 0 : 17;
    const bob = Math.sin((f + phase) * 0.5);
    let punch = 0.04 + 0.2 * Math.max(0, Math.sin((f + phase) * 0.6)) ** 2;
    let kick = 0, rot = 0, x = baseX, jump = 0;
    if (isAggr) {
      const swing = clash * Math.max(0, Math.sin(f * 0.5));
      if (Math.floor(f / 26) % 2 === 0) kick = swing; else punch = Math.max(punch, swing);
      x = baseX + (oppX - 20 * face - baseX) * (clash * 0.85); // close in so blows land
      jump = clash > 0.6 ? ((clash - 0.6) / 0.4) * 22 * Math.max(0, Math.sin(f * 0.55)) : 0; // hop in close combat
    } else {
      const reel = clash * Math.max(0, Math.sin(f * 0.5 + 1.3));
      rot = -face * 22 * reel;
      x = baseX - face * clash * clash * 18; // knocked back → they bounce apart
    }
    const feetY = yAtX(x) - jump + bob * 2 * (1 - clash);
    return { x, feetY, face, punch, kick, rot, bob, scale, color: isUp ? DUEL_UP : DUEL_DOWN };
  };
  const up = build('UP'), dn = build('DOWN');
  if (above) { drawStick(ctx, dn.x, dn.feetY, dn); drawStick(ctx, up.x, up.feetY, up); }
  else { drawStick(ctx, up.x, up.feetY, up); drawStick(ctx, dn.x, dn.feetY, dn); }
  if (clash > 0.5) {
    const def = above ? dn : up;
    const burstA = clash * Math.max(0, Math.sin(f * 0.5 + 1.3));
    if (burstA > 0.12) drawDuelBurst(ctx, def.x, def.feetY - 61 * scale, burstA, above ? DUEL_UP : DUEL_DOWN);
  }
}

// ─── Draw a smooth price line + area against a dashed target line ───
// The right metaphor for an "up or down vs a target" market: one line, the
// price-to-beat as a dashed Target, a soft gradient fill, and a glowing
// current-price dot. (Polymarket-style.)
export function drawPriceLine(
  canvas: HTMLCanvasElement | null,
  series: number[],
  opts: {
    target?: number | null;
    /** Range band [lower, higher] — shaded zone + dashed edges. */
    band?: [number, number] | null;
    color?: string;
    /** Verdict mode: line paints green above the target, red below — the
     *  chart answers "who's winning right now" at a glance. */
    verdict?: boolean;
    padX?: number;
    padTop?: number;
    padBot?: number;
    axisRight?: number;     // px reserved on the right for price labels (0 = none)
    targetLabel?: string;   // pill text on the target line
    gridLines?: boolean;
    xLabels?: string[];     // evenly spaced labels along the bottom
    motion?: boolean;       // animated live chart treatment
    now?: number;           // requestAnimationFrame timestamp
    fighters?: boolean;     // draw the roaming UP-vs-DOWN stick duel on the price line
  } = {},
): void {
  if (!canvas || series.length < 2) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const color = opts.color ?? '#F5A623';
  const padX = opts.padX ?? 12;
  const padTop = opts.padTop ?? 14;
  const padBot = opts.padBot ?? (opts.xLabels ? 22 : 12);
  const axisR = opts.axisRight ?? 0;
  const motion = !!opts.motion;
  const now = opts.now ?? Date.now();
  const pulse = motion ? (Math.sin(now / 190) + 1) / 2 : 0;
  const ink = chartSurfaceLight(canvas) ? LIGHT_INK : DARK_INK;

  // Value range with headroom; include the target so its dashed line is on-canvas.
  let lo = Math.min(...series);
  let hi = Math.max(...series);
  if (opts.target != null) { lo = Math.min(lo, opts.target); hi = Math.max(hi, opts.target); }
  if (opts.band) { lo = Math.min(lo, opts.band[0]); hi = Math.max(hi, opts.band[1]); }
  const headroom = (hi - lo) * 0.12 || Math.max(1, hi * 0.0005);
  lo -= headroom; hi += headroom;
  const range = (hi - lo) || 1;

  const rightEdge = w - axisR;
  const xFor = (i: number) => padX + (i / (series.length - 1)) * (rightEdge - padX * 2);
  const yFor = (v: number) => padTop + (hi - v) * (h - padTop - padBot) / range;
  const pts = series.map((v, i) => ({ x: xFor(i), y: yFor(v) }));

  // Faint gridlines + right-edge price labels
  if (opts.gridLines) {
    ctx.font = '10px JetBrains Mono, monospace';
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const y = padTop + (i / rows) * (h - padTop - padBot);
      ctx.strokeStyle = ink.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(rightEdge, y); ctx.stroke();
      if (axisR > 0) {
        ctx.fillStyle = ink.axisLabel;
        ctx.textAlign = 'left';
        const v = hi - (i / rows) * range;
        ctx.fillText('$' + Math.round(v).toLocaleString(), rightEdge + 6, y + 3);
      }
    }
  }

  // Range band — shaded zone between the two edges + dashed boundary lines
  if (opts.band) {
    const bandCol = opts.color ?? '#E04D26';
    const yHi = yFor(opts.band[1]); // higher price = higher on canvas (smaller y)
    const yLo = yFor(opts.band[0]);
    ctx.fillStyle = hexA(bandCol, 0.1);
    ctx.fillRect(padX, yHi, rightEdge - padX, yLo - yHi);
    ctx.strokeStyle = hexA(bandCol, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const y of [yHi, yLo]) {
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(rightEdge, y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // smoothed path (quadratic midpoints) — shared by fill + stroke
  const tracePath = () => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };

  // Area path (line down to the baseline), shared by all painters
  const traceArea = () => {
    ctx.moveTo(pts[0].x, h - padBot);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(pts[pts.length - 1].x, h - padBot);
    ctx.closePath();
  };

  // Paint fill + line in one color
  const paint = (col: string) => {
    const grd = ctx.createLinearGradient(0, padTop, 0, h - padBot);
    grd.addColorStop(0, hexA(col, 0.2));
    grd.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = grd;
    ctx.beginPath(); traceArea(); ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath(); tracePath(); ctx.stroke();
  };

  const verdict = !!opts.verdict && opts.target != null;
  const UP = '#34D399', DOWN = '#FB7185';
  const last = pts[pts.length - 1];
  const dotCol = verdict
    ? (series[series.length - 1] >= (opts.target as number) ? UP : DOWN)
    : color;

  if (verdict) {
    // Verdict mode: green where the price is above the bar, red below —
    // two clipped passes of the same smooth path, switching at the crossing.
    const yT = yFor(opts.target as number);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, Math.max(0, yT)); ctx.clip();
    paint(UP);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, yT, w, Math.max(0, h - yT)); ctx.clip();
    paint(DOWN);
    ctx.restore();
  } else {
    paint(color);
  }

  // Target (strike) dashed line + pill — vermilion in verdict mode: the decision line
  if (opts.target != null) {
    const y = yFor(opts.target);
    ctx.save();
    ctx.strokeStyle = verdict ? 'rgba(224, 77, 38, 0.75)' : ink.targetLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(rightEdge, y); ctx.stroke();
    ctx.restore();

    const label = opts.targetLabel ?? 'Target';
    if (label) {
      ctx.font = '10px JetBrains Mono, monospace';
      const tw = ctx.measureText(label).width;
      const pw = tw + 14, ph = 16;
      // Anchor the strike pill to the LEFT edge: the current-price dot and the
      // right-axis price labels both live on the right, so a right-anchored pill
      // collides with them whenever spot ≈ strike. Left keeps it clear.
      const px = padX + 2, py = y - ph / 2;
      ctx.fillStyle = 'rgba(38,38,44,0.95)';
      roundRectPath(ctx, px, py, pw, ph, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText(label, px + 7, y + 3.5);
    }
  }

  // Current-price dot + glow — in verdict mode it wears the current verdict
  if (motion) {
    ctx.strokeStyle = hexA(dotCol, 0.24 + pulse * 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(last.x, last.y, 12 + pulse * 8, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = hexA(dotCol, motion ? 0.2 + pulse * 0.08 : 0.18);
  ctx.beginPath(); ctx.arc(last.x, last.y, motion ? 9 + pulse * 4 : 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dotCol;
  ctx.beginPath(); ctx.arc(last.x, last.y, motion ? 3.8 + pulse * 0.8 : 3.5, 0, Math.PI * 2); ctx.fill();

  // The roaming UP-vs-DOWN stick duel, riding the price line end to end
  if (opts.fighters) {
    const yAtX = (x: number): number => {
      if (x <= pts[0].x) return pts[0].y;
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i].x) { const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1); return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t; }
      }
      return pts[pts.length - 1].y;
    };
    const above = opts.target != null ? series[series.length - 1] >= (opts.target as number) : true;
    drawDuel(ctx, { yAtX, xMin: padX, xMax: last.x, h, now, above });
  }

  // X-axis labels
  if (opts.xLabels && opts.xLabels.length > 1) {
    ctx.fillStyle = ink.xLabel;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    const n = opts.xLabels.length;
    opts.xLabels.forEach((lbl, k) => {
      const x = padX + (k / (n - 1)) * (rightEdge - padX * 2);
      ctx.fillText(lbl, Math.min(Math.max(x, 18), rightEdge - 18), h - 5);
    });
  }
}

// ─── Draw sparkline (line + optional fill) ───
export function drawSparkline(
  canvas: HTMLCanvasElement | null,
  data: number[],
  opts: {
    color?: string;
    fillColor?: string;
    lineWidth?: number;
    dotEnd?: boolean;
  } = {}
): void {
  if (!canvas || !data.length) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const color = opts.color || '#E04D26';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const xFor = (i: number) => (i / (data.length - 1)) * w;
  const yFor = (v: number) => 4 + (1 - (v - min) / range) * (h - 8);

  // Fill
  if (opts.fillColor) {
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, opts.fillColor);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  // Line
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.lineWidth ?? 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // End dot
  if (opts.dotEnd !== false) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xFor(data.length - 1), yFor(data[data.length - 1]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Draw equity curve (area chart with zero baseline) ───
export function drawEquityCurve(
  canvas: HTMLCanvasElement | null,
  data: number[]
): void {
  if (!canvas || !data.length) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const eq = chartSurfaceLight(canvas) ? LIGHT_EQ : DARK_EQ;

  const padX = 36;
  const padTop = 18;
  const padBot = 18;
  const maxV = Math.max(...data);
  const minV = Math.min(...data, 0);
  const range = maxV - minV || 1;

  const xFor = (i: number) => padX + (i / (data.length - 1)) * (w - padX * 2);
  const yFor = (v: number) => padTop + (1 - (v - minV) / range) * (h - padTop - padBot);

  // Horizontal rules
  ctx.strokeStyle = eq.rule;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (i / 4) * (h - padTop - padBot);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }

  // Zero baseline
  const yZero = yFor(0);
  ctx.strokeStyle = eq.zero;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(padX, yZero);
  ctx.lineTo(w - padX, yZero);
  ctx.stroke();
  ctx.setLineDash([]);

  // Fill under curve
  const grd = ctx.createLinearGradient(0, padTop, 0, h - padBot);
  grd.addColorStop(0, 'rgba(224, 77, 38, 0.28)');
  grd.addColorStop(1, 'rgba(224, 77, 38, 0.00)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(xFor(0), yZero);
  data.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
  ctx.lineTo(xFor(data.length - 1), yZero);
  ctx.closePath();
  ctx.fill();

  // Curve line
  ctx.strokeStyle = eq.line;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // End dot
  const lastX = xFor(data.length - 1);
  const lastY = yFor(data[data.length - 1]);
  ctx.fillStyle = '#E04D26';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();
  // Halo
  ctx.fillStyle = 'rgba(224, 77, 38, 0.18)';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 9, 0, Math.PI * 2);
  ctx.fill();

  // X-axis labels
  ctx.fillStyle = eq.label;
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ['30D AGO', '15D', 'TODAY'].forEach((lbl, k) => {
    const x = padX + k * ((w - padX * 2) / 2);
    ctx.fillText(lbl, x, h - 4);
  });
}

// ─── Draw probability history chart (0-100%) ───
export function drawProbabilityChart(
  canvas: HTMLCanvasElement | null,
  data: { timestamp: number; probability: number }[]
): void {
  if (!canvas || data.length < 2) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const padX = 10;
  const padTop = 14;
  const padBot = 14;
  const chartW = w - padX * 2;
  const chartH = h - padTop - padBot;

  const tMin = data[0].timestamp;
  const tMax = data[data.length - 1].timestamp;
  const tRange = tMax - tMin || 1;

  const xFor = (t: number) => padX + ((t - tMin) / tRange) * chartW;
  const yFor = (p: number) => padTop + (1 - p / 100) * chartH;

  // Horizontal grid at 0%, 25%, 50%, 75%, 100%
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yFor(pct);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }

  // 50% reference line (dashed vermilion)
  ctx.strokeStyle = 'rgba(224, 77, 38, 0.35)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, yFor(50));
  ctx.lineTo(w - padX, yFor(50));
  ctx.stroke();
  ctx.setLineDash([]);

  // Y-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  for (const pct of [0, 50, 100]) {
    ctx.fillText(`${pct}%`, w - padX + 1, yFor(pct) + 3);
  }

  // Area fill gradient
  const grd = ctx.createLinearGradient(0, padTop, 0, h - padBot);
  grd.addColorStop(0, 'rgba(224, 77, 38, 0.18)');
  grd.addColorStop(1, 'rgba(224, 77, 38, 0.00)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(xFor(data[0].timestamp), yFor(0));
  data.forEach(d => ctx.lineTo(xFor(d.timestamp), yFor(d.probability)));
  ctx.lineTo(xFor(data[data.length - 1].timestamp), yFor(0));
  ctx.closePath();
  ctx.fill();

  // Main line
  ctx.strokeStyle = '#E04D26';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = xFor(d.timestamp);
    const y = yFor(d.probability);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // End dot
  const last = data[data.length - 1];
  const lx = xFor(last.timestamp);
  const ly = yFor(last.probability);
  ctx.fillStyle = '#E04D26';
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(224, 77, 38, 0.2)';
  ctx.beginPath();
  ctx.arc(lx, ly, 8, 0, Math.PI * 2);
  ctx.fill();
}
