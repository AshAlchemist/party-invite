// Сборка приглашения. Запускать из каталога проекта.
//   node tools/build.mjs --site dist/site          — сайт для хостинга: index.html + assets/
//   node tools/build.mjs --single party.html       — один HTML-файл: шрифты, фото, видео и скрипты встроены
//   --url https://домен/                           — адрес сайта: делает картинку предпросмотра ссылки (og:image) абсолютной
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const site = args.includes('--site');
const out = args[args.indexOf(site ? '--site' : '--single') + 1];
if (!out || (!site && !args.includes('--single'))) { console.error('нужно: --site <папка> или --single <файл.html>'); process.exit(2); }

const base = args.includes('--url') ? String(args[args.indexOf('--url') + 1] || '').replace(/\/?$/, '/') : '';
if (base && !/^https?:\/\/[^\s"<>]+\/$/.test(base)) { console.error('--url: нужен адрес вида https://домен/'); process.exit(2); }
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', mp4: 'video/mp4', woff2: 'font/woff2' };
const ext = f => f.split('.').pop();
const dataUri = file => `data:${MIME[ext(file)]};base64,${readFileSync(file).toString('base64')}`;
const need = file => { if (!existsSync(file)) throw new Error('нет файла ' + file); return file; };
if (site) for (const dir of ['assets/img', 'assets/js', 'assets/fonts', 'assets/video']) mkdirSync(join(out, dir), { recursive: true });
else mkdirSync(dirname(out) || '.', { recursive: true });

// ресурс → адрес (сайт: копия в assets/, один файл: data URI)
const used = new Set();
function asset(kind, name, srcDir) {
  const src = need(join(srcDir, name));
  if (!site) return dataUri(src);
  if (!used.has(kind + name)) { copyFileSync(src, join(out, 'assets', kind, name)); used.add(kind + name); }
  return `assets/${kind}/${name}`;
}

let html = readFileSync('src/index.html', 'utf8');

// --- шрифты: курсив антиквы на странице не используется — не везём ---
const fontCss = readFileSync('fonts/fonts.tpl.css', 'utf8').split('\n')
  .filter(l => l.trim() && !l.includes('font-style:italic'))
  .join('\n')
  .replace(/\{\{FONT:([\w.-]+)\}\}/g, (_, n) => asset('fonts', n, 'fonts'));

// --- стили ---
const css = readFileSync('src/style.css', 'utf8');
html = html.replace('/*FONTS*/', () => fontCss).replace('/*CSS*/', () => css);

// --- предзагрузка главного (только для сайта: в едином файле всё уже внутри) ---
const preload = site ? [
  '<link rel="preload" href="assets/fonts/noto-serif-display-normal-cyrillic.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="assets/fonts/great-vibes-normal-cyrillic.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" as="image" type="image/webp" href="assets/img/glass.webp" imagesrcset="assets/img/glass-760.webp 760w, assets/img/glass.webp 1380w" imagesizes="(min-width: 1000px) 42vw, 92vw" fetchpriority="high">',
].join('\n') : '';
html = html.replace('<!--PRELOAD-->', () => preload);

// --- картинка для предпросмотра ссылки: в едином файле бессмысленна ---
if (!site || !existsSync('assets/img/og.jpg')) html = html.replace(/^.*\{\{IMG:og\.jpg\}\}.*\n/m, '');

// --- картинки и видео ---
html = html.replace(/\{\{IMG:([\w.-]+)\}\}/g, (_, n) => (n === 'og.jpg' ? base : '') + asset('img', n, 'assets/img'));
html = html.replace(/\{\{VIDEO\}\}/g, () => asset('video', 'gift.mp4', 'assets/video'));

// --- скрипты: GSAP (бесплатная лицензия GreenSock), Lenis (MIT), свои ---
const scripts = [
  ['vendor', 'gsap.min.js'], ['vendor', 'ScrollTrigger.min.js'], ['vendor', 'SplitText.min.js'], ['vendor', 'CustomEase.min.js'], ['vendor', 'lenis.min.js'],
  ['src', 'silver.js'], ['src', 'app.js'],
].map(([dir, f]) => {
  if (site) { copyFileSync(need(join(dir, f)), join(out, 'assets/js', f)); return `<script src="assets/js/${f}" defer></script>`; }
  const code = readFileSync(need(join(dir, f)), 'utf8');
  if (/<\/script/i.test(code)) throw new Error('в ' + f + ' есть </script> — встраивать нельзя');
  return `<script>${code}</script>`;
}).join('\n');
html = html.replace('<!--SCRIPTS-->', () => scripts);

const left = html.match(/\{\{[A-Z]+[:}][^}]*\}?\}?|<!--(PRELOAD|SCRIPTS)-->|\/\*(FONTS|CSS)\*\//);
if (left) throw new Error('остался плейсхолдер: ' + left[0]);
const file = site ? join(out, 'index.html') : out;
writeFileSync(file, html);
console.log(file, (Buffer.byteLength(html) / 1024).toFixed(0) + ' КБ');
