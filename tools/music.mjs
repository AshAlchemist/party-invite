// Музыка и видео: node tools/music.mjs <url страницы>
// Браузер запускается с политикой «звук только после жеста», как на телефоне.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/srv/agent/tools/browser/node_modules/');
const { chromium } = require('playwright-core');

const url = process.argv[2];
const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const step = s => console.log('ok —', s);
const state = page => page.evaluate(() => {
  const a = document.querySelector('#music'), v = document.querySelector('#video'), b = document.querySelector('#sound');
  return { music: !a.paused, t: +a.currentTime.toFixed(2), video: !v.paused, videoMuted: v.muted, btn: !b.hidden, on: b.classList.contains('is-on') };
});
async function until(page, fn, what, ms = 8000) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < ms) { s = await state(page); if (fn(s)) return s; await page.waitForTimeout(250); }
  throw new Error(what + ': ' + JSON.stringify(s));
}
async function scrollTo(page, sel) {   // плавно, как гость: листы и наблюдатели срабатывают по пути
  await page.evaluate(async sel => {
    const end = sel === 'top' ? 0 : document.querySelector(sel).getBoundingClientRect().top + scrollY;
    const from = scrollY, n = 30;
    for (let i = 1; i <= n; i++) { scrollTo(0, from + (end - from) * i / n); await new Promise(r => setTimeout(r, 40)); }
  }, sel);
}

// 1. обычный вход через занавес
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('#introGo').waitFor({ state: 'visible', timeout: 12000 });
  let s = await state(page);
  assert.equal(s.music, false, 'музыка заиграла до касания');
  assert.equal(s.btn, false, 'кнопка звука видна до касания');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !document.activeElement.closest('main')), true, 'Tab ушёл под занавес');
  step('до касания тишина, занавес ждёт: «Открыть приглашение»; Tab не уходит под занавес');

  await page.locator('#introGo').click();
  s = await until(page, s => s.music && s.t > 0.5, 'музыка не пошла после касания');
  assert.equal(s.btn && s.on, true, 'кнопка звука не показана включённой');
  const dur = await page.evaluate(() => document.querySelector('#music').duration);
  assert.ok(dur > 330 && dur < 350, 'длительность файла ' + dur + ' (ожидалось ≈343 с — трек с 0:20)');
  await page.waitForFunction(() => !document.querySelector('#intro'), null, { timeout: 8000 });
  step(`касание раскрыло занавес и включило музыку (файл ${dur.toFixed(0)} с — трек с 0:20)`);

  await scrollTo(page, '#gift');
  await page.evaluate(() => document.querySelector('#screen').scrollIntoView({ block: 'center' }));
  s = await until(page, s => s.video && !s.videoMuted, 'видео не пошло со звуком', 10000);
  s = await until(page, s => !s.music, 'музыка не затихла на последнем листе', 6000);
  step('последний лист: видео идёт со звуком, музыка плавно затихла и встала на паузу');

  await scrollTo(page, 'top');
  s = await until(page, s => s.music && !s.video, 'музыка не вернулась наверху', 8000);
  step('вверх от последнего листа: видео на паузе, музыка вернулась');

  await page.locator('#sound').click();
  s = await until(page, s => !s.music && !s.on, 'кнопка не выключила музыку', 4000);
  await page.locator('#sound').click();
  s = await until(page, s => s.music && s.on, 'кнопка не включила музыку', 4000);
  step('кнопка звука выключает и включает музыку');

  await scrollTo(page, '#gift');
  await page.evaluate(() => document.querySelector('#screen').scrollIntoView({ block: 'center' }));
  s = await until(page, s => s.video && !s.videoMuted && !s.music, 'второй заход на последний лист: видео со звуком, музыка молчит', 10000);
  assert.equal(s.on, false, 'кнопка показывает «музыка играет», хотя она молчит');
  await page.locator('#sound').click();
  s = await until(page, s => s.music && s.on && !s.video, 'включение музыки на последнем листе: музыка играет, видео на паузе', 5000);
  await page.waitForTimeout(1500);
  s = await state(page);
  assert.equal(s.video, false, 'видео само заиграло поверх музыки');
  assert.equal(await page.locator('#play span').textContent(), 'Продолжить');
  step('на последнем листе кнопка показывает «выкл»; включение музыки ставит видео на паузу, два звука не играют');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 2. «меньше движения»: занавеса нет, музыка начинается с первого касания страницы
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  let s2 = await state(page);
  assert.equal(s2.music, false);
  // жест не засчитан (на телефоне — прокрутка пальцем): play() отклонён, запуск не должен сгореть.
  // Playwright даёт странице активацию уже при загрузке, поэтому отказ браузера имитируем подменой play()
  await page.evaluate(() => {
    const P = HTMLMediaElement.prototype, orig = P.play;
    P.play = function () { P.play = orig; return Promise.reject(new DOMException('проверка', 'NotAllowedError')); };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await page.waitForTimeout(600);
  s2 = await state(page);
  assert.equal(s2.music, false, 'музыка без жеста');
  assert.equal(s2.btn, false, 'кнопка звука осталась после отказа браузера');
  await page.locator('#cover').click({ position: { x: 30, y: 300 } });
  await until(page, s => s.music && s.btn, 'музыка не пошла с касания после отклонённой попытки');
  await ctx.close();
  step('без занавеса: попытка без жеста не расходует запуск, музыка начинается с касания страницы');
}

// 3. анимация занавеса падает в момент касания: занавес всё равно уходит, страница доступна
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    let g;
    Object.defineProperty(window, 'gsap', { configurable: true, get: () => g, set: v => {
      g = v; const orig = v.timeline.bind(v); let armed = false;
      v.timeline = (...x) => { if (armed) throw new Error('проверка: сбой анимации занавеса'); return orig(...x); };
      addEventListener('click', () => { armed = true; }, true);
    } });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('#introGo').click({ timeout: 12000 });
  await page.waitForFunction(() => !document.querySelector('#intro') && !document.documentElement.classList.contains('is-loading') && !document.querySelector('main').inert, null, { timeout: 10000 });
  await ctx.close();
  step('сбой анимации при касании: занавес снят, страница доступна');
}

await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
