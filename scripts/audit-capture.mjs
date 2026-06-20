// Hands-on flaw audit: drive every public route in the running dev server with a
// real browser (system Chrome), at mobile + desktop widths, as a first-time user
// with NO wallet connected. Capture full-page screenshots + any console errors /
// failed requests — the stuff a controlled Zoom demo never surfaces.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/yosuku-audit';
mkdirSync(OUT, { recursive: true });

// Real BTC market id (for the detail route) — pulled live at runtime if missing.
let MARKET_ID = process.env.MARKET_ID || '';

const ROUTES = [
  ['home', '/'],
  ['markets', '/markets'],
  ['market-detail', () => `/markets/${MARKET_ID}`],
  ['bell', '/bell'],
  ['earn', '/earn'],
  ['pool', '/pool'],
  ['portfolio', '/portfolio'],
  ['leaderboard', '/leaderboard'],
  ['agents', '/agents'],
  ['strategies', '/strategies'],
  ['surface', '/surface'],
  ['stats', '/stats'],
  ['status', '/status'],
  ['parlay', '/parlay'],
  ['how-it-works', '/how-it-works'],
  ['docs', '/docs'],
];

const VIEWPORTS = [
  ['mobile', 390, 844],
  ['desktop', 1366, 900],
];

const report = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// fetch a real market id if not provided
if (!MARKET_ID) {
  try {
    const page = await browser.newPage();
    const res = await page.goto(`${BASE}/api/oracles`, { timeout: 20000 });
    const data = await res.json();
    MARKET_ID = data?.[0]?.oracle_id || '';
    await page.close();
  } catch { /* leave blank; detail route will be skipped */ }
}

for (const [vpName, w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  for (const [name, pathOrFn] of ROUTES) {
    const path = typeof pathOrFn === 'function' ? pathOrFn() : pathOrFn;
    if (path.includes('/markets/') && !MARKET_ID) {
      report.push({ route: name, viewport: vpName, skipped: 'no market id' });
      continue;
    }
    const page = await ctx.newPage();
    const consoleErrors = [];
    const failedReqs = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)));
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (!u.startsWith('data:') && !u.includes('chrome-extension')) failedReqs.push(`${r.failure()?.errorText || 'failed'} ${u.slice(0, 120)}`);
    });
    let status = 0;
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
      status = resp?.status() || 0;
    } catch (e) {
      report.push({ route: name, viewport: vpName, error: String(e).slice(0, 200) });
    }
    // let client render / animations settle
    await page.waitForTimeout(2500);
    // detect horizontal overflow (the "exceeds width" bug class)
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const scrollW = doc.scrollWidth;
      const clientW = doc.clientWidth;
      const offenders = [];
      if (scrollW > clientW + 1) {
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.right > clientW + 2 && r.width > 24) {
            offenders.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), right: Math.round(r.right) });
          }
          if (offenders.length >= 6) break;
        }
      }
      return { scrollW, clientW, horizontalOverflow: scrollW > clientW + 1, offenders };
    });
    const file = `${OUT}/${name}-${vpName}.png`;
    try { await page.screenshot({ path: file, fullPage: true }); } catch { /* ignore */ }
    report.push({ route: name, viewport: vpName, path, status, file, consoleErrors, failedReqs, overflow });
    await page.close();
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify({ marketId: MARKET_ID, report }, null, 2));

// terse console summary
console.log('MARKET_ID:', MARKET_ID || '(none)');
for (const r of report) {
  const flags = [];
  if (r.error) flags.push('NAV-ERR');
  if (r.status && r.status >= 400) flags.push('HTTP' + r.status);
  if (r.consoleErrors?.length) flags.push(`console:${r.consoleErrors.length}`);
  if (r.failedReqs?.length) flags.push(`reqfail:${r.failedReqs.length}`);
  if (r.overflow?.horizontalOverflow) flags.push(`OVERFLOW(${r.overflow.scrollW}>${r.overflow.clientW})`);
  console.log(`${(r.route + '/' + r.viewport).padEnd(28)} ${flags.length ? flags.join(' ') : 'ok'}`);
}
console.log('\nartifacts in', OUT);
