// Скриншоты: node tools/shot.mjs <url> <out.png> [--w 390] [--h 844] [--full] [--wait 1500] [--y 0] [--dpr 2] [--eval "js"] [--sel css]
import { createRequire } from 'node:module';
const require = createRequire('/srv/agent/tools/browser/node_modules/');
const { chromium } = require('playwright-core');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const [url, out] = a;
const w = +opt('--w', 390), h = +opt('--h', 844), dpr = +opt('--dpr', 2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, reducedMotion: a.includes('--reduce') ? 'reduce' : 'no-preference', hasTouch: w < 800, isMobile: w < 800 });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+opt('--wait', 1500));
const y = opt('--y', null);
if (a.includes('--walk')) { const to = y === null || y === 'end' ? 1e9 : +y; await page.evaluate(async to => { const st = innerHeight * 0.45; for (let p = 0; p < Math.min(to, document.documentElement.scrollHeight - innerHeight); p += st) { scrollTo(0, p); await new Promise(r => setTimeout(r, 220)); } }, to); }
if (y !== null) { await page.evaluate(yy => window.scrollTo(0, yy === 'end' ? document.documentElement.scrollHeight : +yy), y); await page.waitForTimeout(+opt('--wait2', 900)); }
const ev = opt('--eval', null);
if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(+opt('--wait3', 600)); }
const sel = opt('--sel', null);
if (sel) await page.locator(sel).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: a.includes('--full') });
if (logs.length) console.log(logs.slice(0, 12).join('\n'));
await browser.close();
