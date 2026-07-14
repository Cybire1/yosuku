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
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(rightEdge, y); ctx.stroke();
      if (axisR > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
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
    ctx.strokeStyle = verdict ? 'rgba(224, 77, 38, 0.75)' : 'rgba(255,255,255,0.32)';
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

  // X-axis labels
  if (opts.xLabels && opts.xLabels.length > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
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

  const padX = 36;
  const padTop = 18;
  const padBot = 18;
  const maxV = Math.max(...data);
  const minV = Math.min(...data, 0);
  const range = maxV - minV || 1;

  const xFor = (i: number) => padX + (i / (data.length - 1)) * (w - padX * 2);
  const yFor = (v: number) => padTop + (1 - (v - minV) / range) * (h - padTop - padBot);

  // Horizontal rules
  ctx.strokeStyle = 'rgba(201,191,166,0.4)';
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
  ctx.strokeStyle = 'rgba(26,22,18,0.35)';
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
  ctx.strokeStyle = '#1A1612';
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
  ctx.fillStyle = '#6B6353';
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
