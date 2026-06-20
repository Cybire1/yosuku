import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
// find fixed/absolute elements hugging the right edge near the top, or anything overflowing right
const hits = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fixedOrAbs = cs.position === 'fixed' || cs.position === 'sticky';
    const rightEdge = r.right >= vw - 4 && r.left > vw * 0.6; // hugs right edge
    if ((fixedOrAbs && rightEdge) || (rightEdge && r.top < 300 && r.width < 120)) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,70), pos: cs.position, top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), txt: (el.textContent||'').trim().slice(0,30) });
    }
  }
  return { vw, out: out.slice(0, 14) };
});
console.log('viewport width', hits.vw);
for (const h of hits.out) console.log(JSON.stringify(h));
await b.close();
