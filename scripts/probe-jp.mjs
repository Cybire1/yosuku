import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const el = document.querySelector('.stats-jp');
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { found: true, display: cs.display, fontSize: cs.fontSize, opacity: cs.opacity, color: cs.color, right: cs.right, w: Math.round(r.width), vw: innerWidth, text: el.textContent };
});
console.log(JSON.stringify(info));
await b.close();
