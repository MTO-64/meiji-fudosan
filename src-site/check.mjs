#!/usr/bin/env node
// 新サイトの本文欠落を文単位で調べる。旧ページのp, li, td, th, h2, h3の文が新ページに残っているか。
// 見ていないもの: 文の順序、意味の変化、画像。トップはトップ専用に書き直したので別枠で一覧を出す。
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = process.env.OUT || ROOT;
const walk = (d, b = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), `${b}${e.name}/`) : [`${b}${e.name}`]));
const pages = walk(join(ROOT, 'content')).filter((p) => p.endsWith('index.html'));
if (!pages.length) { console.error('比較対象が0件'); process.exit(2); }

const WIDE = /[０-９]/g;
const clean = (s) => s.replace(/<[^>]+>/g, '').replace(WIDE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/ｍ/g, 'm').replace(/ＪＲ/g, 'JR').replace(/&amp;/g, '&').replace(/[\s→・、,()（）]/g, '');
let lostTotal = 0;
let checked = 0;
for (const rel of pages) {
  const old = readFileSync(join(ROOT, 'content', rel), 'utf8');
  const body = rel === 'index.html' ? old.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '') : (old.match(/<main[^>]*>([\s\S]*?)<\/main>/) || [])[1] || '';
  const now = clean(readFileSync(join(OUT, rel), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
  const units = [...body.matchAll(/<(p|li|td|th|h2|h3|div class="(?:faq-q|faq-a|desc)")[^>]*>([\s\S]*?)<\/(?:p|li|td|th|h2|h3|div)>/g)].map((m) => clean(m[2].replace(/出典[：:][\s\S]*$/, '').replace(/<br\s*\/?>\s*$/, '')));
  const lost = units.filter((u) => u.length >= 6 && !now.includes(u) && !/^出典/.test(u) && !/確認日/.test(u));
  checked += units.length;
  if (lost.length) {
    lostTotal += lost.length;
    console.log(`${rel}: ${lost.length}件`);
    lost.slice(0, Number(process.argv[2] || 6)).forEach((u) => console.log(`   ${u.slice(0, 64)}`));
  }
}
console.log(`照合 ${pages.length}ページ ${checked}要素 / 欠落 ${lostTotal}件`);
process.exitCode = lostTotal ? 1 : 0;
