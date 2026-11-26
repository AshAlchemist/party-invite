// Приём анкет с приглашения «Это моя вечеринка»: каждая анкета — строка на листе «Ответы».
// Гость, нажавший «Изменить ответы», обновляет свою строку (по ID анкеты), а не добавляет новую.

const SHEET_NAME = 'Ответы';
const QUESTIONS = [
  'Какую самую странную вещь ты когда-либо покупал?',
  'Какой самый смешной или нелепый повод заставлял тебя опаздывать?',
  'Если бы ты имел возможность сменить профессию прямо завтра, кем бы ты стал?',
  'Какую суперспособность ты бы выбрал, если бы она была максимально бесполезной?',
  'Какую песню ты знаешь наизусть, хотя немного стыдно в этом признаваться?',
  'Какой самый необычный комплимент ты получал?',
  'Как давно мы знакомы?',
  'Какое прозвище тебе давали?',
  'Если бы тебе пришлось всю жизнь есть одно блюдо, что бы это было?',
  'Если бы тебе дали миллион рублей, но потратить его нужно было за сутки, что бы ты сделал?',
];
const HEADERS = ['Получено', 'Изменено', 'Имя'].concat(QUESTIONS.map((q, i) => (i + 1) + '. ' + q), ['ID анкеты']);
const FIELDS = ['name'].concat(QUESTIONS.map((q, i) => 'q' + (i + 1)));

// Запустите один раз вручную: Google попросит разрешение и создаст лист с заголовками.
function setup() {
  sheet_();
}

// Открыть адрес веб-приложения в браузере — проверка, что развёртывание живо.
function doGet() {
  return out_({ ok: true, message: 'Приём анкет работает' });
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.website) return out_({ ok: true });                // поле-ловушка заполняют только боты
  const name = clean_(p.name, 120);
  if (!name) return out_({ ok: false, error: 'empty name' });

  // Любой сбой возвращается ответом {ok:false}: страница покажет гостю «не получилось», а не «записано».
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return out_({ ok: false, error: 'busy' });   // две анкеты одновременно не затрут друг друга
  try {
    const sh = sheet_();
    const now = new Date();
    const id = id_(p.id);
    const values = FIELDS.map(f => safe_(f === 'name' ? name : clean_(p[f], 1000)));
    const row = id ? findRow_(sh, id) : 0;
    if (row) sh.getRange(row, 2, 1, HEADERS.length - 1).setValues([[now].concat(values, [id])]);
    else sh.appendRow([now, ''].concat(values, [id]));
  } catch (err) {
    return out_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
  return out_({ ok: true });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME, 0);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#DDD5C5').setWrap(true);
    sh.getRange('A:B').setNumberFormat('dd.MM.yyyy HH:mm');
    sh.getRange('C:N').setNumberFormat('@');                 // ответы — всегда текст: «12.12» и «1/2» не станут датами
  }
  return sh;
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, HEADERS.length, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

// ID анкеты выдаёт страница (буквы, цифры, дефис). Всё иное отбрасывается: анкета запишется новой строкой без ID.
function id_(v) {
  const id = clean_(v, 64);
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) ? id : '';
}

function clean_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// Таблица исполняет текст, начинающийся с = + - @, как формулу; апостроф делает его просто текстом.
function safe_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
