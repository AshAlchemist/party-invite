// Проверка живого приёма анкет:
//   node tools/check-sheet.mjs <адрес веб-приложения …/exec> [<ссылка на таблицу>]
// 1) GET  …/exec  → {"ok":true}
// 2) POST тестовой анкеты (имя «ТЕСТ — удалите строку») → {"ok":true}
// 3) повторный POST с тем же ID → {"ok":true} (обновление той же строки)
// 4) если дана ссылка на таблицу с доступом по ссылке — читает лист «Ответы» и ищет строку с ID:
//    одна строка, имя и ответ на вопрос 10 после правки.
// Тестовую строку после проверки удаляют вручную.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// fetch в Node 22 берёт прокси из окружения только с NODE_USE_ENV_PROXY=1
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const [exec, sheetUrl] = process.argv.slice(2);
if (!exec || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(exec)) {
  console.error('Нужен адрес вида https://script.google.com/macros/s/…/exec');
  process.exit(2);
}
const step = s => console.log('ok —', s);

async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { throw new Error(`ответ не JSON (HTTP ${res.status}): ${t.slice(0, 200).replace(/\s+/g, ' ')}`); }
}

// 1. развёртывание живо и открыто для всех
{
  const r = await fetch(exec, { redirect: 'follow' });
  const d = await json(r).catch(e => { throw new Error(e.message + '\nВероятно, в развёртывании «У кого есть доступ» не «Все» или адрес не …/exec.'); });
  assert.equal(d.ok, true, 'GET вернул ' + JSON.stringify(d));
  step('веб-приложение отвечает: ' + JSON.stringify(d));
}

// 2–3. тестовая анкета и её правка — тем же способом, что страница (form-urlencoded)
const id = 'check-' + Date.now().toString(36);
const form = (q10) => {
  const p = new URLSearchParams({ id, name: 'ТЕСТ — удалите строку', website: '' });
  for (let i = 1; i <= 10; i++) p.set('q' + i, i === 10 ? q10 : 'проверка ' + i);
  return p;
};
for (const [q10, label] of [['первый ответ', 'тестовая анкета записана'], ['ответ после правки', 'правка той же анкеты принята']]) {
  const r = await fetch(exec, { method: 'POST', body: form(q10), redirect: 'follow' });
  const d = await json(r);
  assert.equal(d.ok, true, 'POST вернул ' + JSON.stringify(d));
  step(label);
}

// 4. строка в таблице
if (sheetUrl) {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([\w-]+)/);
  assert.ok(m, 'ссылка на таблицу не распознана');
  const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Ответы')}`;
  let rows = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(csvUrl, { redirect: 'follow' });
    const t = await r.text();
    if (!r.ok || /^\s*</.test(t)) throw new Error(`таблица не читается по ссылке (HTTP ${r.status}): нужен доступ «Все, у кого есть ссылка»`);
    rows = parseCsv(t);
    if (rows.some(x => x.includes(id))) break;
    await new Promise(res => setTimeout(res, 2000));
  }
  const head = rows[0] || [];
  assert.equal(head.length >= 14, true, 'на листе «Ответы» меньше 14 столбцов: ' + head.join(' | '));
  assert.match(head[2] || '', /Имя/, 'третий столбец не «Имя»: ' + head[2]);
  const mine = rows.filter(x => x.includes(id));
  assert.equal(mine.length, 1, `строк с ID ${id}: ${mine.length} (ожидалась одна)`);
  assert.equal(mine[0][2], 'ТЕСТ — удалите строку');
  assert.equal(mine[0][12], 'ответ после правки');
  step(`в таблице одна строка ${rows.indexOf(mine[0]) + 1} с ID ${id}, правка обновила её`);
}
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ. Удалите в таблице строку «ТЕСТ — удалите строку».');

function parseCsv(t) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
