/**
 * Yosuku Canvas Chart System
 * Candlestick, area, and sparkline rendering for prediction market charts.
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
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
        candles.push({ open: prev.close, high: prev.close, low: prev.close, close: prev.close });
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
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
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
  const candleW = Math.max(2, Math.min(opts.maxCandleW || 8, innerW / candles.length * 0.65));
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
    const isUp = c.close >= c.open;
    const color = isUp ? 'rgba(224, 77, 38, 0.95)' : 'rgba(255, 255, 255, 0.42)';
    const fillC = isUp ? 'rgba(224, 77, 38, 1)' : 'rgba(115, 115, 115, 0.7)';

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
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
