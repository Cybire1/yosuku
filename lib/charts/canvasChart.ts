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
const dlerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const dpulse = (x: number, c: number, w: number): number => { const t = Math.max(0, 1 - Math.abs(x - c) / w); return t * t * (3 - 2 * t); };
// A parametric line-fighter. Both arms punch independently (pL = lead jab, pR = rear
// cross), the lead leg kicks, the resting hands weave in an organic boxing-guard bob
// (gx/gy), and the head snaps (hx/hy) when hit. Poses are keyframe-mixed 0..1.
function drawStick(
  ctx: CanvasRenderingContext2D, cx: number, feetY: number,
  p: { face: number; rot: number; pL: number; pR: number; kick: number; gx: number; gy: number; hx: number; hy: number; scale: number; color: string },
) {
  const { face, rot, pL, pR, kick, gx, gy, hx, hy, scale, color } = p;
  // lead (front) arm: guard by the chin → straight jab fully extended
  let lEl = dmix([face * 9, -45], [face * 24, -45], pL), lHa = dmix([face * 14, -55], [face * 52, -46], pL);
  // rear (back) arm: tucked guard → cross driven across the body
  let rEl = dmix([face * -8, -47], [face * 21, -44], pR), rHa = dmix([face * -3, -56], [face * 50, -45], pR);
  // organic guard bob on whichever hand isn't committed, counter-phased L/R
  const wl = 1 - pL, wr = 1 - pR;
  lEl = [lEl[0] + gx * 0.5 * wl, lEl[1] + gy * 0.5 * wl]; lHa = [lHa[0] + gx * wl, lHa[1] + gy * wl];
  rEl = [rEl[0] - gx * 0.5 * wr, rEl[1] - gy * 0.5 * wr]; rHa = [rHa[0] - gx * wr, rHa[1] - gy * wr];
  const lKn = dmix([face * 9, 22], [face * 27, 4], kick), lFo = dmix([face * 13, 46], [face * 55, -5], kick);
  const rKn = [face * -11, 22], rFo = [face * -18, 46];
  ctx.save();
  ctx.translate(cx, feetY - 46 * scale);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (a: number[], b: number[], c?: number[]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); if (c) ctx.lineTo(c[0], c[1]); ctx.stroke(); };
  seg([0, 0], rKn, rFo);
  seg([0, 0], lKn, lFo);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(hx * 0.28, -46); ctx.stroke(); // torso leans a touch with the recoil
  seg([hx * 0.28, -42], rEl, rHa);
  seg([hx * 0.28, -42], lEl, lHa);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hx, -61 + hy, 13, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// A crisp impact spark: alternating short/long spokes + a bright core flash, sized to the fighter.
function drawDuelBurst(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string, m: number) {
  a = Math.max(0, Math.min(1, a));
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, 2.2 * m);
  ctx.globalAlpha = a;
  const grow = (4 + a * 7) * m; // scales with the fighter, so it never dwarfs a small figure
  [15, 60, 105, 150, 195, 240, 285, 330].forEach((d, i) => {
    const r = (d * Math.PI) / 180, len = grow * (i % 2 ? 0.62 : 1.05);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(r) * grow * 0.42, y + Math.sin(r) * grow * 0.42);
    ctx.lineTo(x + Math.cos(r) * len, y + Math.sin(r) * len);
    ctx.stroke();
  });
  ctx.globalAlpha = a * 0.95; ctx.fillStyle = '#FFF3E0';
  ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 2.3 * a * m), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
export function drawDuel(
  ctx: CanvasRenderingContext2D,
  o: { yAtX: (x: number) => number; xMin: number; xMax: number; h: number; now: number; above: boolean; move?: number },
) {
  const { yAtX, xMin, xMax, now, above, move = 0 } = o;
  // The ATTACKER follows the price MOVEMENT: ticking up → YES (up) presses, ticking down → NO
  // (down) presses. On a dead-flat tick, the current market leader (above/below the line) presses.
  const attackUp = move > 0 ? true : move < 0 ? false : above;
  const span = xMax - xMin;
  if (span < 120) return;
  const f = now / 16.667;
  const wf = Math.min(1, span / 800);
  const scale = Math.max(0.16, Math.min(0.29, 0.12 + 0.17 * wf)); // slightly bigger, still mobile-responsive
  const mid = (xMin + xMax) / 2;
  const drift = mid + span * 0.18 * Math.sin(f * 0.005); // the whole bout drifts slowly across the card

  // ── one committed strike per round: square up · close · SNAP · impact · recover · back off ──
  const CYC = 84, CONTACT = 48;                          // frames; the blow lands at CONTACT
  const cyc = ((f % CYC) + CYC) % CYC;
  const round = Math.floor(f / CYC);
  const closeB = dpulse(cyc, CONTACT, 20);               // 0 at range → 1 at contact (one approach+retreat)
  const sep = 56 - 36 * closeB;                          // closest exactly when the blow lands
  const upX0 = drift - sep / 2, dnX0 = drift + sep / 2;
  // aggressor's strike extension: anticipation (coil back) → snap (accelerate out) → follow-through
  let strikeExt = 0;
  if (cyc >= 40 && cyc <= 64) {
    if (cyc < 45) strikeExt = -0.3 * ((cyc - 40) / 5);                                 // wind up: pull the fist back
    else if (cyc < CONTACT) strikeExt = dlerp(-0.3, 1.08, ((cyc - 45) / (CONTACT - 45)) ** 2); // SNAP (ease-in, fast)
    else strikeExt = dlerp(1.08, 0, 1 - (1 - (cyc - CONTACT) / 16) ** 2);              // recover (ease-out)
  }
  const sType = round % 3;                               // 0 jab (lead) · 1 cross (rear) · 2 kick
  // impact only when the strike is actually extended AND they're closed in — never on the wind-up or at range
  const contact = dpulse(cyc, CONTACT, 2.6) * Math.max(0, Math.min(1, strikeExt)) * closeB;

  const build = (who: 'UP' | 'DOWN') => {
    const isUp = who === 'UP';
    const face = isUp ? 1 : -1;                          // squared up; they never cross
    const baseX = isUp ? upX0 : dnX0;
    const oppX = isUp ? dnX0 : upX0;
    const isAggr = isUp === attackUp;
    // organic boxing-guard bob (small circle), calmer as they close in
    const ph = isUp ? 0 : 2.1, amp = 1 - 0.6 * closeB;
    let gx = Math.cos(f * 0.17 + ph) * 3.0 * amp, gy = Math.sin(f * 0.23 + ph) * 2.4 * amp;
    let pL = 0, pR = 0, kick = 0, rot = 0, x = baseX, jump = 0, hx = 0, hy = 0;
    if (isAggr) {
      const e = Math.max(0, strikeExt);
      if (sType === 0) pL = e; else if (sType === 1) pR = e; else kick = e;
      const lunge = Math.max(0, Math.min(1, strikeExt));
      x = strikeExt < 0 ? baseX + face * strikeExt * 4        // small step back on the wind-up
                        : baseX + (oppX - 11 * face - baseX) * lunge; // drive bodyweight in so the fist reaches
      rot = face * (strikeExt < 0 ? strikeExt * 6 : strikeExt * 5);
      if (sType === 2) jump = e * 5;                         // slight lift on the kick
    } else {
      // defender: head snaps back, torso recoils, knocked back — timed just after contact, decaying
      const react = dpulse(cyc, CONTACT + 3, 10);
      hx = -face * 8 * react; hy = -4 * react;
      rot = -face * 15 * react; x = baseX - face * 8 * react;
      gx *= 1 - react; gy *= 1 - react;
    }
    const feetY = yAtX(x) - jump;
    return { x, feetY, face, pL, pR, kick, rot, gx, gy, hx, hy, scale, color: isUp ? DUEL_UP : DUEL_DOWN };
  };
  const up = build('UP'), dn = build('DOWN');
  // draw the defender first so the aggressor overlaps on top through the strike
  if (attackUp) { drawStick(ctx, dn.x, dn.feetY, dn); drawStick(ctx, up.x, up.feetY, up); }
  else { drawStick(ctx, up.x, up.feetY, up); drawStick(ctx, dn.x, dn.feetY, dn); }
  const def = attackUp ? dn : up;
  const isKick = sType === 2;
  // punches land on the head; kicks land at the waist
  const hitX = def.x + (isKick ? 0 : def.hx * scale) + (attackUp ? -1 : 1) * 4 * scale;
  const hitY = isKick ? def.feetY - 34 * scale : def.feetY - 100 * scale + def.hy * scale;
  if (contact > 0.12) drawDuelBurst(ctx, hitX, hitY, contact, attackUp ? DUEL_UP : DUEL_DOWN, scale / 0.24);

  // ── hit number: a tiny "+N" attack-pop rises from the impact and fades (game juice). N tracks
  //    the real recent price move, so the winner lands harder when the market's ripping. ──
  const POP_LEN = 18;
  if (cyc >= CONTACT && cyc <= CONTACT + POP_LEN) {
    const p = (cyc - CONTACT) / POP_LEN;
    const a = (p < 0.14 ? p / 0.14 : Math.pow(1 - (p - 0.14) / 0.86, 1.5)) * 0.7; // snap in, graceful out, a little sheer
    const popS = p < 0.14 ? 0.62 + 0.38 * (p / 0.14) : 1;                 // subtle scale-in
    const val = Math.max(1, Math.round(Math.abs(move)));
    const label = `${attackUp ? '+' : '−'}${val}`;                  // up-tick = YES lands (+ green); down-tick = NO lands (− red)
    const fontPx = (4 + 12 * scale) * popS;                              // extra-small + sheer
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = `600 ${fontPx}px ui-monospace, "JetBrains Mono", monospace`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0.3px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(4,8,7,0.7)'; ctx.shadowBlur = 3;             // soft halo, not a hard outline
    const tx = hitX + (attackUp ? -1 : 1) * 5 * scale, ty = hitY - 6 * scale - p * 22 * scale;
    ctx.fillStyle = attackUp ? DUEL_UP : DUEL_DOWN;
    ctx.fillText(label, tx, ty);
    ctx.restore();
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
      const pw = tw + 10, ph = 16;
      // Anchor the strike pill to the LEFT edge: the current-price dot and the
      // right-axis price labels both live on the right, so a right-anchored pill
      // collides with them whenever spot ≈ strike. Left keeps it clear.
      const px = padX + 2, py = y - ph / 2;
      ctx.fillStyle = 'rgba(38,38,44,0.95)';
      roundRectPath(ctx, px, py, pw, ph, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText(label, px + 5, y + 3.5);
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
    const k = Math.min(6, series.length - 1); // recent move (~last few ticks) → the hit's "damage"
    const move = k > 0 ? series[series.length - 1] - series[series.length - 1 - k] : 0;
    drawDuel(ctx, { yAtX, xMin: padX, xMax: last.x, h, now, above, move });
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
