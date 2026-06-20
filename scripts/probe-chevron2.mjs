import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
const stats = await page.$('.stats');
if (stats) await stats.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const hits = await page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const inView = r.top < vh && r.bottom > 0;
    const huggsRight = r.right >= vw - 6 && r.left > vw * 0.55 && r.width < 160;
    const isFixed = cs.position === 'fixed';
    if (inView && (huggsRight || (isFixed && r.left > vw*0.5))) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,60), pos: cs.position, top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), txt: (el.textContent||'').trim().slice(0,24) });
    }
  }
  return out.slice(0, 12);
});
for (const h of hits) console.log(JSON.stringify(h));
await b.close();
