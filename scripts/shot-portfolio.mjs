import { chromium } from 'playwright';
const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newContext({viewport:{width:1440,height:1100}}).then(c=>c.newPage());
await p.goto('http://localhost:3000/portfolio',{waitUntil:'domcontentloaded',timeout:30000});
await p.waitForTimeout(4000);
await p.screenshot({path:'/tmp/portfolio-now.png',fullPage:true});
console.log('shot saved');
await b.close();
