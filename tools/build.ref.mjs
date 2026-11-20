// Сборка приглашения.
//   node build.mjs template.html <uploads> out.html          — единый HTML: шрифты и фото встроены как data URI
//   node build.mjs template.html <uploads> <папка> --site    — сайт для GitHub Pages: index.html + assets/
import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

const [tplPath, uploadsDir, outPath] = process.argv.slice(2);
const site = process.argv.includes('--site');
if (site) for (const d of ['assets/fonts', 'assets/img', 'assets/js']) mkdirSync(join(outPath, d), {recursive: true});
const preload = [];
const proxy = process.env.HTTPS_PROXY || '';
const curl = (url, dest) => execFileSync('curl', ['-sSf', '-m', '30', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', ...(proxy ? ['-x', proxy] : []), '-o', dest, url]);

// --- шрифты ---
mkdirSync('fonts', {recursive: true});
const css = readFileSync('fonts.css', 'utf8');
const blocks = [...css.matchAll(/\/\* (\w[\w-]*) \*\/\s*@font-face \{([^}]+)\}/g)]
  .filter(m => m[1] === 'cyrillic' || m[1] === 'latin')
  .map(m => ({
    subset: m[1],
    family: m[2].match(/font-family: '([^']+)'/)[1],
    style: m[2].match(/font-style: (\w+)/)[1],
    weight: m[2].match(/font-weight: (\d+)/)[1],
    url: m[2].match(/url\(([^)]+)\)/)[1],
    range: m[2].match(/unicode-range: ([^;]+);/)[1],
  }));
const byUrl = new Map();
for (const b of blocks) {
  const k = b.url;
  if (!byUrl.has(k)) byUrl.set(k, {...b, weights: []});
  byUrl.get(k).weights.push(+b.weight);
}
let fontCss = '';
for (const f of byUrl.values()) {
  const file = join('fonts', f.url.split('/').pop());
  if (!existsSync(file)) curl(f.url, file);
  const w = [...new Set(f.weights)].sort();
  const weight = w.length > 1 ? `${w[0]} ${w.at(-1)}` : w[0];
  let src;
  if (site) {
    const name = `${f.family.toLowerCase().replace(/ /g, '-')}-${f.style}-${f.subset}.woff2`;
    copyFileSync(file, join(outPath, 'assets/fonts', name));
    src = `assets/fonts/${name}`;
    if (f.style === 'normal' && f.subset === 'cyrillic') preload.push(`<link rel="preload" href="${src}" as="font" type="font/woff2" crossorigin>`);
  } else src = `data:font/woff2;base64,${readFileSync(file).toString('base64')}`;
  fontCss += `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${weight};font-display:swap;src:url(${src}) format('woff2');unicode-range:${f.range}}\n`;
}

// --- фото ---
const imgs = {
  '7370': 'mvjmhqho-IMG_7370.JPG', '7372': 'mvjmhq8h-IMG_7372.JPG', '7373': 'mvjmhqbk-IMG_7373.JPG',
  '7374': 'mvjmhqdw-IMG_7374.JPG', '7375': 'mvjmhqg3-IMG_7375.JPG', '7376': 'mvjmhq6h-IMG_7376.JPG',
  '7797': 'mvmfik7n-IMG_7797.JPG', '7808': 'mvmfkia3-IMG_7808.JPG',
};
const siteNames = {'7370': 'qr-vk.jpg', '7372': 'bw-bridge.jpg', '7373': 'bride.jpg', '7374': 'groom.jpg', '7375': 'photo-frame.jpg', '7376': 'hero.jpg',
  '7797': 'couple.jpg', '7808': 'embankment.jpg'};
let html = readFileSync(tplPath, 'utf8').replace('/*FONTS*/', fontCss.trim());
// первый экран — конверт: фактура и печать нужны раньше всего
if (site) for (const f of ['paper.webp', 'seal.webp']) preload.push(`<link rel="preload" href="assets/img/${f}" as="image" type="image/webp">`);
html = html.replace('<!--PRELOAD-->', site ? preload.join('\n') : '');
html = html.replace(/\{\{IMG:(\d+)\}\}/g, (_, id) => {
  if (!imgs[id]) throw new Error('нет фото ' + id);
  if (!site) return 'data:image/jpeg;base64,' + readFileSync(join(uploadsDir, imgs[id])).toString('base64');
  copyFileSync(join(uploadsDir, imgs[id]), join(outPath, 'assets/img', siteNames[id]));
  return 'assets/img/' + siteNames[id];
});

// --- нарисованные картинки (assets-src: фактура бумаги, восковая печать) ---
const mime = {webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg'};
html = html.replace(/\{\{ASSET:([\w.-]+)\}\}/g, (_, name) => {
  const src = join('assets-src', name);
  if (!existsSync(src)) throw new Error('нет картинки ' + src);
  if (!site) return `data:${mime[name.split('.').pop()]};base64,` + readFileSync(src).toString('base64');
  copyFileSync(src, join(outPath, 'assets/img', name));
  return 'assets/img/' + name;
});

// --- библиотеки анимации: GSAP (стандартная лицензия GreenSock, бесплатна) и Lenis (MIT) ---
const vendor = ['gsap.min.js', 'CustomEase.min.js', 'ScrollTrigger.min.js', 'SplitText.min.js', 'lenis.min.js'];
const scripts = vendor.map(f => {
  if (!site) return `<script>${readFileSync(join('vendor', f), 'utf8')}</script>`;
  copyFileSync(join('vendor', f), join(outPath, 'assets/js', f));
  return `<script src="assets/js/${f}"></script>`;
}).join('\n');
// функция-замена: в коде библиотек есть «$», строка-замена исказила бы его
html = html.replace('<!--VENDOR-->', () => scripts);
if (/\{\{(IMG|ASSET):|<!--VENDOR-->/.test(html)) throw new Error('остались плейсхолдеры');
writeFileSync(site ? join(outPath, 'index.html') : outPath, html);
console.log('шрифтов:', byUrl.size, 'размер:', (html.length / 1024).toFixed(0), 'КБ');
