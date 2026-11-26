// Аварийные сценарии: node tools/robust.mjs <url страницы>
// Страница должна остаться читаемой и рабочей при сбое WebGL, сбое сценария анимаций, без localStorage,
// на низком экране и при работе с клавиатуры.
import { createRequire } from 'node:module';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire('/srv/agent/tools/browser/node_modules/');
const { chromium } = require('playwright-core');

const url = process.argv[2];
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const step = name => console.log('ok —', name);

async function open(viewport, init, mobile = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  // боевая таблица в проверках не участвует: всё, что ушло бы на Google, обрывается
  await ctx.route(/script\.google(usercontent)?\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#intro') && !document.documentElement.classList.contains('is-loading'), null, { timeout: 20000 });
  return { ctx, page, errors };
}

// всё, что анимации прячут до появления, после прокрутки страницы должно быть видно
async function hiddenAfterWalk(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= h; y += 500) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
  // лист, накрытый следующим, скрыт намеренно (visibility:hidden у .stack) — для проверки возвращаем его
  const probe = () => {
    document.querySelectorAll('.stack').forEach(s => { s.style.visibility = 'visible'; });
    return [...document.querySelectorAll('main [data-in], main [data-rise], main [data-chars], main [data-write], main [data-photo], .title__fit, #glass, .note__hi')]
      .filter(e => { const s = getComputedStyle(e); return e.offsetParent !== null && (s.visibility === 'hidden' || +s.opacity < 0.95); })
      .map(e => e.tagName + '.' + e.className);
  };
  for (let i = 0; i < 12; i++) {           // анимации появления идут до 2–3 с: ждём, пока доиграют
    await page.waitForTimeout(500);
    if (!(await page.evaluate(probe)).length) return [];
  }
  return page.evaluate(probe);
}
// поля анкеты проявляются при прокрутке: сначала докручиваем до поля, потом заполняем
async function fillName(page, name) {
  await page.evaluate(() => document.querySelector('#f-name').scrollIntoView({ block: 'center' }));
  await page.locator('#f-name').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#f-name').fill(name);
  await page.evaluate(() => document.querySelector('#go').scrollIntoView({ block: 'center' }));
  await page.locator('#go').waitFor({ state: 'visible', timeout: 8000 });
}
async function wheelMoves(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(1500);
  return page.evaluate(() => Math.round(window.scrollY));
}

// 1. шейдеры не собираются (старый или сломанный видеодрайвер)
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, () => {
    const P = WebGL2RenderingContext.prototype, orig = P.getShaderParameter;
    P.getShaderParameter = function (s, p) { return p === this.COMPILE_STATUS ? false : orig.call(this, s, p); };
  });
  assert.ok(await wheelMoves(page) > 300, 'страница не прокручивается колесом');
  assert.deepEqual(await hiddenAfterWalk(page), []);
  await ctx.close();
  step('сбой WebGL: страница прокручивается, весь контент виден');
}

// 2. сценарий появления падает на середине (ScrollTrigger.batch бросает исключение)
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, () => {
    let st;
    Object.defineProperty(window, 'ScrollTrigger', { configurable: true, get: () => st, set: v => { st = v; v.batch = () => { throw new Error('проверка: сбой сценария'); }; } });
  });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-plain')), true, 'аварийный режим не включился');
  assert.ok(await wheelMoves(page) > 300, 'страница не прокручивается колесом');
  assert.deepEqual(await hiddenAfterWalk(page), []);
  await ctx.close();
  step('сбой сценария анимаций: аварийный режим, прокрутка работает, весь контент виден');
}

// 3. телефон на боку: кнопка закрытия финала на экране (режим показа — самый высокий вариант финала)
for (const [w, h] of [[844, 390], [844, 340], [667, 375]]) {
  const { ctx, page } = await open({ width: w, height: h }, null, true);
  await page.evaluate(() => { window.PARTY.endpoint = ''; });   // режим показа — на боевой адрес не отправляем
  await fillName(page, 'Гость');
  await page.locator('#go').click();
  await page.waitForFunction(() => !document.querySelector('#finale').hidden);
  await page.waitForTimeout(3600);
  const box = await page.locator('#finaleNext').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= h + 1, `кнопка финала за краем экрана ${w}×${h}: ${box && Math.round(box.y)}..${box && Math.round(box.y + box.height)}`);
  const top = await page.locator('#finaleTitle').boundingBox();
  assert.ok(top && top.y >= -1, `заголовок финала выше экрана ${w}×${h}: ${top && Math.round(top.y)}`);
  await ctx.close();
}
step('финал на низком экране (844×390, 844×340, 667×375): заголовок и кнопка закрытия на экране');

// 4. приватный режим без localStorage: правка обновляет ту же анкету
{
  const got = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST') got.push(Object.fromEntries(new URLSearchParams(body)));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"ok":true}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { ctx, page } = await open({ width: 390, height: 844 }, () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  }, true);
  await page.evaluate(e => { window.PARTY.endpoint = e; }, `http://127.0.0.1:${srv.address().port}/exec`);
  await fillName(page, 'Гость без хранилища');
  await page.locator('#go').click();
  await page.waitForFunction(() => !document.querySelector('#finale').hidden);

  // 5. клавиатура: Tab не уходит под финал, после закрытия фокус у экрана подарка
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('#finale'); }), true, 'фокус ушёл под финал');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#finale').hidden, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'giftTitle');
  assert.equal(await page.evaluate(() => document.querySelector('main').inert), false);
  step('финал удерживает фокус; после закрытия фокус у экрана подарка, страница снова доступна');

  await page.locator('#edit').scrollIntoViewIfNeeded();
  await page.locator('#edit').click();
  await page.locator('#q1').fill('передумал');
  await page.locator('#go').scrollIntoViewIfNeeded();
  await page.locator('#go').click();
  await page.waitForFunction(() => !document.querySelector('#finale').hidden);
  assert.equal(got.length, 2);
  assert.equal(got[1].id, got[0].id);
  assert.match(got[0].id, /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/);
  await ctx.close();
  srv.closeAllConnections();
  await new Promise(r => srv.close(r));
  step('без localStorage: повторная отправка идёт с тем же ID анкеты');
}

await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
