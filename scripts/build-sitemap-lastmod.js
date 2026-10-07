#!/usr/bin/env node
'use strict';
/* build-sitemap-lastmod.js — sitemap.xml の各URLの <lastmod> を、そのページのファイルを最後に変更したgitコミットの日付にする。
 * 方針(Google公式: lastmodは本文・構造化データ・リンク等の重要な変更の日付として一貫して正確な場合に利用される):
 *  - 手で書かない・全ページを今日にしない。ページのファイル自体が変わった日だけを出す。
 *  - 未コミットの変更があるページは今日の日付。gitに履歴が無いページは lastmod を付けない(嘘の日付を出さない)。
 * 射程外: 共通CSS(assets/landing.css)の変更は各ページのファイルが変わらないので反映されない(本文の変更ではないため意図的)。
 * 使い方: node scripts/build-bukken.js の後に実行。冪等。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SM = path.join(ROOT, 'sitemap.xml');
let xml = fs.readFileSync(SM, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=off', ...a], { cwd: ROOT, encoding: 'utf8' });
let dirty;
try {
  // -z: パスをクォートせず NUL 区切りで受け取る。リネームは "R  新\0旧" の2要素なので旧パスも変更扱いにする
  const parts = git('status', '--porcelain=v1', '-z').split('\0').filter(Boolean);
  dirty = new Set();
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2), p = parts[i].slice(3);
    dirty.add(p);
    if (code[0] === 'R' || code[0] === 'C') { i++; dirty.add(parts[i]); }
  }
} catch (e) {
  console.error('ERROR: git が使えないため lastmod を更新しません（sitemap.xml は変更していません）。'); process.exit(2);
}
let n = 0, none = 0;
xml = xml.replace(/<url>([\s\S]*?)<\/url>/g, (block, inner) => {
  const loc = (inner.match(/<loc>https:\/\/meijifudosan\.com([^<]*)<\/loc>/) || [])[1];
  if (loc === undefined) return block;
  const file = (loc === '/' ? 'index.html' : loc.replace(/^\//, '') + 'index.html');
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`sitemap に載っているのにファイルがありません: ${loc}`);
  const isDirty = dirty.has(file) || [...dirty].some(x => x.endsWith('/') && file.startsWith(x)); // 未追跡ディレクトリ(新規ページ)も含む
  let d = isDirty ? today : git('log', '-1', '--format=%cs', '--', file).trim();
  const rest = inner.replace(/\s*<lastmod>[^<]*<\/lastmod>/, '');
  if (!d) { none++; return `<url>${rest}</url>`; }
  n++;
  return `<url>${rest.replace(/(<loc>[^<]*<\/loc>)/, `$1\n    <lastmod>${d}</lastmod>`)}</url>`;
});
if (xml !== fs.readFileSync(SM, 'utf8')) fs.writeFileSync(SM, xml); // 変化が無ければ書き込まない(冪等)
console.log(`sitemap lastmod: ${n}件に設定 / 履歴なしで省略 ${none}件`);
