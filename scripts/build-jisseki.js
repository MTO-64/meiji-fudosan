#!/usr/bin/env node
'use strict';
/* build-jisseki.js — scripts/jisseki.json の confirmed:true の事例だけから /jisseki/index.html を生成する。
 * 設計: 実績は「確認済みの事実」だけを載せる。confirmed が1件も無い時はページを作らず、sitemap・リンクにも出さない
 * （空のページや架空の事例を公開しない）。冪等。依存ゼロ。
 * 射程外: 事例の真偽そのものは検査できない。confirmed を true にする責任は人(owner)にある。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'jisseki.json'), 'utf8'));
const cases = (data.cases || []).filter(c => c.confirmed === true);
const OUT_DIR = path.join(ROOT, 'jisseki');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const URL = 'https://meijifudosan.com/jisseki/';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let sm = fs.readFileSync(SITEMAP, 'utf8');
const hasUrl = sm.includes(`<loc>${URL}</loc>`);

if (cases.length === 0) {
  // 取り下げ・個人情報の問題が出た事例を公開し続けないよう、0件になったらページとsitemap行も消す
  if (fs.existsSync(path.join(OUT_DIR, 'index.html'))) { fs.rmSync(path.join(OUT_DIR, 'index.html')); try { fs.rmdirSync(OUT_DIR); } catch (_) {} console.log('confirmed が0件: 既存の /jisseki/ を削除しました。'); }
  else console.log('confirmed な事例が0件: /jisseki/ は生成しません。');
  if (hasUrl) { sm = sm.replace(/\s*<url>\s*<loc>https:\/\/meijifudosan\.com\/jisseki\/<\/loc>[\s\S]*?<\/url>/, ''); fs.writeFileSync(SITEMAP, sm); console.log('sitemap から /jisseki/ を削除しました。'); }
  process.exit(0);
}
const TEXT_KEYS = ['area', 'type', 'asking_price', 'result', 'side', 'situation', 'issue', 'what_we_did', 'period'];
const norm = v => String(v == null ? '' : v).replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[－ー‐―]/g, '-');
const GENERIC_RE = /(皆|お客|所有者|売主|買主|ご家族|ご親族|相続人|お施主|購入希望者|ご依頼者|ご相談者)(様|さん)/g;
const PII = [
  [/0\d{1,4}-\d{1,4}-\d{3,4}/, '電話番号'], [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'メールアドレス'],
  [/(?<!\d)\d{1,4}-\d{1,4}(?:-\d{1,4})?(?!\d)(?!年|月|日)/, '番地らしい数字(○-○)'], [/\d+丁目\d+/, '丁目の先の番地'], [/\d+番地?\d*号?/, '番地'],
];
const NAME_RE = /[一-龥ぁ-んァ-ヶー]{1,4}(様|さん|氏)/;
const hasNameLike = v => { const w = v.replace(GENERIC_RE, ''); const m = w.match(NAME_RE); return m ? m[0] : null; };
const PLACEHOLDER = /(記入してください|記入例|どちらかを記入|未確認|例文|サンプル|ダミー|TODO|XXX|\(.*(?:どちらか|記入).*\))/;
for (const c of cases) {
  const miss = ['area', 'type', 'result', 'side', 'situation', 'what_we_did', 'period'].filter(k => !String(c[k] || '').trim());
  if (miss.length) { console.error(`ERROR: ${c.id} は confirmed なのに未記入の欄があります: ${miss.join(', ')}`); process.exit(2); }
  if (c.privacy_checked !== true) { console.error(`ERROR: ${c.id} は privacy_checked が true ではありません（売主買主が特定されないことをownerが確認してから true にする）`); process.exit(2); }
  for (const k of TEXT_KEYS) {
    const v = norm(c[k]);
    if (PLACEHOLDER.test(v)) { console.error(`ERROR: ${c.id}.${k} が記入例・仮の文言のままです: ${v.slice(0, 30)}`); process.exit(2); }
    // 日付(2026-01-15)と「3-4か月」「500-600万円」のような範囲は番地ではないので検査から外す
    const vp = v.replace(/\d{4}-\d{1,2}(-\d{1,2})?/g, '').replace(/\d+-\d+(?=か月|ヶ月|ヵ月|年|日|週間|万円|件|㎡|坪|%)/g, '');
    for (const [re, label] of PII) if (re.test(/電話|メール/.test(label) ? v : vp)) { console.error(`ERROR: ${c.id}.${k} に${label}が含まれています: ${v.slice(0, 40)}`); process.exit(2); }
    const nm = hasNameLike(v); if (nm) { console.error(`ERROR: ${c.id}.${k} に個人名の可能性(${nm})があります。「お客様」等の一般語以外の「○○様」は書かない`); process.exit(2); }
  }
  if (!/^(成約|取り下げ|成約済み)$/.test(String(c.result).trim()) ) { console.error(`ERROR: ${c.id}.result は「成約」「取り下げ」「成約済み」のいずれかにしてください`); process.exit(2); }
}
const tpl = fs.readFileSync(path.join(ROOT, 'ishioka/before-selling/index.html'), 'utf8');
const iMain = tpl.indexOf('<main class="lp-main">'), iEnd = tpl.indexOf('</main>');
if (iMain < 0 || iEnd < 0 || !tpl.includes('<nav class="breadcrumb"') || !tpl.includes('<section class="lp-hero">')) { console.error('ERROR: テンプレート(ishioka/before-selling/index.html)の構造が想定と違います。'); process.exit(2); }
const head = tpl.slice(0, iMain).replace(/<nav class="breadcrumb"[\s\S]*?<\/nav>/, `<nav class="breadcrumb" aria-label="パンくずリスト">
  <a href="/">トップ</a>
  <span class="breadcrumb-sep">›</span>
  <span>取り扱い実績</span>
</nav>`);
const foot = tpl.slice(iEnd);
const title = '取り扱い実績｜石岡市周辺の土地・空き家 | 株式会社明治不動産';
const desc = `株式会社明治不動産が取り扱った石岡市周辺の土地・空き家などの事例${cases.length}件。状況・課題・対応・期間を、個人が特定されない範囲でご紹介します。`;
const items = cases.map(c => `
<section>
<h2>${esc(c.area)}の${esc(c.type)}（${esc(c.result)}）</h2>
<table class="lp-table"><tbody>
  <tr><th>所在地</th><td>${esc(c.area)}</td></tr>
  <tr><th>種別</th><td>${esc(c.type)}</td></tr>
  ${c.asking_price ? `<tr><th>売出価格</th><td>${esc(c.asking_price)}</td></tr>` : ''}
  <tr><th>立場</th><td>${esc(c.side)}</td></tr>
  <tr><th>結果</th><td>${esc(c.result)}</td></tr>
  <tr><th>期間</th><td>${esc(c.period)}</td></tr>
</tbody></table>
<h3>状況</h3><p>${esc(c.situation)}</p>
${c.issue ? `<h3>課題</h3><p>${esc(c.issue)}</p>` : ''}
<h3>当社の対応</h3><p>${esc(c.what_we_did)}</p>
</section>`).join('\n');
let html = head
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
  .replace(/https:\/\/meijifudosan\.com\/ishioka\/before-selling\//g, URL)
  .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
  .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
  .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
  .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(desc)}$2`);
html = html.replace(/<section class="lp-hero">[\s\S]*$/, `<section class="lp-hero">
  <h1>取り扱い実績</h1>
  <p class="subtitle">当社が取り扱った事例です。売主様・買主様が特定されないよう、所在地は町名までとし、内容は一部を省いています。</p>
</section>

<main class="lp-main">
${items}
`) + foot.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '').replace('</body>', `<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: 'トップ', item: 'https://meijifudosan.com/' },
  { '@type': 'ListItem', position: 2, name: '取り扱い実績', item: URL }] }, null, 2)}
</script>
</body>`);
if (!html.includes('<h1>取り扱い実績</h1>') || !html.includes(`<link rel="canonical" href="${URL}">`) || html.includes('売る前に確認すること')) { console.error('ERROR: テンプレートの置換に失敗しました(canonical/見出し/パンくず)。'); process.exit(2); }
if ((tpl.match(/<\/main>/g) || []).length !== 1 || iEnd < iMain) { console.error('ERROR: テンプレートの<main>構造が想定と違います。'); process.exit(2); }
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
if (!hasUrl) { sm = sm.replace('</urlset>', `  <url>\n    <loc>${URL}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n</urlset>`); fs.writeFileSync(SITEMAP, sm); }
console.log(`生成: /jisseki/ (${cases.length}件)`);
