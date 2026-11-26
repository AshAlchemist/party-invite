// Сквозная проверка анкеты: node tools/e2e.mjs <url страницы>
// Поднимает приёмник-заглушку вместо Google, заполняет форму, проверяет отправку, финал, повторный вход и сбой сети.
import { createRequire } from 'node:module';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire('/srv/agent/tools/browser/node_modules/');
const { chromium } = require('playwright-core');

const url = process.argv[2];
const got = [];
let broken = false;   // приёмник «сломан»: отвечает страницей ошибки без CORS-заголовка, как Apps Script при исключении
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST') got.push(Object.fromEntries(new URLSearchParams(body)));
    if (broken) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Exception: Lock timeout</body></html>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"ok":true}');
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${srv.address().port}/exec`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
// боевая таблица в проверках не участвует: всё, что ушло бы на Google, обрывается
await ctx.route(/script\.google(usercontent)?\.com/, r => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const step = (name) => console.log('ok —', name);

await page.goto(url, { waitUntil: 'load' });
await page.locator('#introGo').click({ timeout: 15000 });   // занавес ждёт касания гостя
await page.waitForFunction(() => !document.querySelector('#intro') && !document.documentElement.classList.contains('is-loading'), null, { timeout: 15000 });
step('занавес открылся и убран');

// 1. пустое имя не отправляется
await page.evaluate(e => { window.PARTY.endpoint = e; }, endpoint);
await page.locator('#go').scrollIntoViewIfNeeded();
await page.locator('#go').click();
await page.waitForTimeout(400);
assert.equal(got.length, 0);
assert.match(await page.locator('#status').textContent(), /имя/);
assert.equal(await page.locator('#finale').isHidden(), true);
step('без имени анкета не уходит, показана подсказка');

// 2. заполнение и отправка
await page.locator('#f-name').fill('Анна Тестовая');
await page.locator('#q1').fill('Надувной фламинго');
await page.locator('#q7').fill('Лет пять, не меньше');
await page.locator('#q10').fill('=СУММ(1;2)');
assert.equal(await page.locator('#q7').inputValue(), 'Лет пять, не меньше');
assert.equal((await page.locator('#count').textContent()).trim(), 'Отвечено 3 из 10');
await page.locator('#go').click();
await page.waitForFunction(() => !document.querySelector('#finale').hidden, null, { timeout: 8000 });
const shownAt = Date.now();
assert.equal(got.length, 1);
assert.equal(got[0].name, 'Анна Тестовая');
assert.equal(got[0].q1, 'Надувной фламинго');
assert.equal(got[0].q7, 'Лет пять, не меньше');
assert.equal(got[0].q2, '');
assert.ok(got[0].id && got[0].id.length > 8);
assert.equal(await page.locator('#finaleDemo').isHidden(), true);
assert.match(await page.locator('#finale').innerText(), /СПАСИБО/i);
step('анкета ушла на приёмник: имя, ответы, ID; открыт финал без пометки показа');

// 3. дождь идёт: верхняя полоса экрана (там только дождь) меняется от кадра к кадру
await page.waitForTimeout(2500);
const strip = { x: 0, y: 0, width: 390, height: 150 };
const f1 = await page.screenshot({ clip: strip });
await page.waitForTimeout(500);
const f2 = await page.screenshot({ clip: strip });
assert.ok(!f1.equals(f2), 'дождь не движется');
assert.ok(f1.length > 3000, 'полоса пустая: ' + f1.length);
step('серебряный дождь движется (кадры различаются, ' + f1.length + ' и ' + f2.length + ' байт)');

// 4. без касаний: через 2 с после прорисовки «СПАСИБО» (2,45 с) финал закрывается и страница плавно едет к видео
await page.waitForFunction(() => document.querySelector('#finale').classList.contains('is-leaving'), null, { timeout: 9000 });
const after = (Date.now() - shownAt) / 1000;
assert.ok(after >= 4.0 && after <= 5.6, `автопереход через ${after.toFixed(1)} с после «СПАСИБО» (ожидалось ≈ 4,45 с)`);
// замеряем движение по низу экрана с видео: страница едет, а не прыгает, и останавливается, когда видео видно целиком
const vh = await page.evaluate(() => innerHeight);
const path = [];
for (let i = 0; i < 24; i++) {
  path.push(await page.evaluate(() => Math.round(document.querySelector('#screen').getBoundingClientRect().bottom)));
  if (path.length > 3 && path.at(-1) === path.at(-2) && path.at(-1) <= vh) break;
  await page.waitForTimeout(150);
}
const scr = await page.evaluate(() => { const r = document.querySelector('#screen').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
assert.ok(scr.top >= 0 && scr.bottom <= vh, `экран с видео виден не целиком: ${scr.top}..${scr.bottom} при высоте ${vh}`);
assert.ok(path[0] > vh + 100, 'перед прокруткой видео уже на экране — ехать некуда: ' + path.join(' → '));
assert.ok(path.some(p => p > scr.bottom + 40 && p < path[0] - 40), 'прокрутка не плавная: ' + path.join(' → '));
await page.waitForFunction(() => document.querySelector('#finale').hidden, null, { timeout: 5000 });
await page.waitForFunction(() => !document.querySelector('#video').paused, null, { timeout: 6000 })
  .catch(async () => { throw new Error('после автоперехода видео не запустилось: ' + JSON.stringify(await page.evaluate(() => { const r = document.querySelector('#screen').getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight }; }))); });
assert.equal(await page.locator('#done').isVisible(), true);
assert.equal(await page.locator('#form').isHidden(), true);
step(`через ${after.toFixed(1)} с финал закрылся сам, страница плавно доехала до видео (${path.join(' → ')}), карточка в состоянии «Спасибо»`);

// 5. повторный вход: состояние и черновик сохранены, правка обновляет ту же анкету
await page.reload({ waitUntil: 'load' });
await page.locator('#introGo').click({ timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('#intro'), null, { timeout: 15000 });
assert.equal(await page.locator('#done').isHidden(), false);
await page.evaluate(e => { window.PARTY.endpoint = e; }, endpoint);
await page.locator('#edit').scrollIntoViewIfNeeded();
await page.locator('#edit').click();
assert.equal(await page.locator('#f-name').inputValue(), 'Анна Тестовая');
await page.locator('#q2').fill('Кот сел на ключи');
await page.locator('#go').scrollIntoViewIfNeeded();
await page.locator('#go').click();
await page.waitForFunction(() => !document.querySelector('#finale').hidden, null, { timeout: 8000 });
assert.equal(got.length, 2);
assert.equal(got[1].id, got[0].id);
assert.equal(got[1].q2, 'Кот сел на ключи');
// кнопка проявляется к 3,2 с — раньше автоперехода (4,45 с); нажимаем сразу, как проявилась
await page.waitForFunction(() => +getComputedStyle(document.querySelector('#finaleNext')).opacity >= 0.99, null, { timeout: 8000 });
assert.equal(await page.evaluate(() => document.querySelector('#finale').classList.contains('is-leaving')), false, 'финал закрылся сам до нажатия кнопки');
await page.locator('#finaleNext').dispatchEvent('click');
await page.waitForFunction(() => document.querySelector('#finale').hidden, null, { timeout: 5000 });
let y1 = -1;
for (let i = 0; i < 20; i++) {             // прокрутка к видео идёт до 1,6 с — ждём, пока встанет
  const y = await page.evaluate(() => Math.round(scrollY));
  if (y === y1) break;
  y1 = y;
  await page.waitForTimeout(300);
}
await page.waitForTimeout(3000);          // таймер автоперехода не должен сработать после закрытия кнопкой
assert.equal(await page.locator('#finale').isHidden(), true);
assert.equal(await page.evaluate(() => Math.round(scrollY)), y1, 'страница сдвинулась после закрытия финала кнопкой');
await page.keyboard.press('Escape');       // Esc без открытого финала ничего не ломает
step('после перезагрузки ответы на месте; правка уходит с тем же ID; «и последнее…» закрывает финал, таймер не срабатывает повторно');

// 6. приёмник ответил ошибкой, которую браузер не даёт прочитать: успех показывать нельзя
broken = true;
const sentBefore = await page.evaluate(() => localStorage.getItem('party:sent'));
await page.locator('#edit').scrollIntoViewIfNeeded();
await page.locator('#edit').click();
await page.locator('#go').scrollIntoViewIfNeeded();
await page.locator('#go').click();
await page.waitForFunction(() => /Не получилось/.test(document.querySelector('#status').textContent) || !document.querySelector('#finale').hidden, null, { timeout: 30000 });
assert.equal(await page.locator('#finale').isHidden(), true, 'ошибка приёмника показана гостю как успех');
assert.equal(await page.evaluate(() => localStorage.getItem('party:sent')), sentBefore);
assert.equal(await page.locator('#go').isDisabled(), false);
assert.equal(got.length, 3, 'после неподтверждённого ответа анкета отправлена повторно вслепую');
broken = false;
step('ошибка приёмника без CORS не выдаётся за успех: сообщение, финала нет');

// 7. сбой сети: понятное сообщение, финала нет
await new Promise(r => { srv.close(r); srv.closeAllConnections(); });
await page.locator('#go').scrollIntoViewIfNeeded();
await page.locator('#go').click();
await page.waitForFunction(() => /Не получилось/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
assert.equal(await page.locator('#finale').isHidden(), true);
assert.equal(await page.locator('#go').isDisabled(), false);
step('при сбое сети — сообщение об ошибке, кнопка снова активна');

// ожидаемые сообщения браузера: отказ CORS на шаге 6 и обрыв соединения на шаге 7
assert.deepEqual(errors.filter(e => !/ERR_CONNECTION_REFUSED|Failed to fetch|Failed to load resource|blocked by CORS policy/.test(e)), []);
step('ошибок в консоли нет');
await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
