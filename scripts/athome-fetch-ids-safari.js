#!/usr/bin/env node
/* athome 自社(062449)の掲載中物件IDを、通常のSafari(osascript)で取得し「カテゴリ:ID」を1行ずつ stdout に出す。
 * athome-fetch-ids.js(Playwright)は athome の bot 判定(Reese84)に弾かれて 0 件になる(2026-10-07 実測)ため、
 * 実ブラウザの Safari を使う。出力形式と終了コードは athome-fetch-ids.js と同じ。
 *   exit 0: 取得成功 / exit 2: 取得失敗（黙って成功扱いにしない）
 * 取得するのはIDだけ(物件内容の転載はしない)。アクセスは一覧3〜5ページ・1日1回まで(launchd側で制御)。
 * 前提: Safari で「開発」メニュー→「Apple Events からの JavaScript を許可」がON(既にON)。
 * 射程外: 物件の中身(価格・面積)の変化は見ない。IDの増減だけ。価格変更は athome-details.json の再取得(手動)で拾う。 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LISTS = ['tochi', 'kodate', 'buy_store', 'rent_store'];
// rent_office の一覧は rent_store と同じIDを返す(2026-10-07 実測)ため取得対象に入れない。

const OSA = (url) => `
tell application "Safari"
  set madeDoc to false
  if (count of windows) = 0 then
    make new document
    set madeDoc to true
  end if
  set t to missing value
  try
    tell front window
      set t to make new tab with properties {URL:"${url}"}
    end tell
    delay 12
    set r to do JavaScript "(function(){var a=[...new Set([...document.querySelectorAll('a[href]')].map(x=>x.href).map(h=>{var m=h.match(/athome\\\\.co\\\\.jp\\\\/(tochi|kodate|buy_store|rent_store|rent_office)\\\\/(\\\\d{8,12})\\\\//);return m?m[1]+':'+m[2]:null}).filter(Boolean))];return a.join('|')+'#'+location.href+'#'+document.title})()" in t
  on error
    set r to "ERR##"
  end try
  try
    if t is not missing value then close t
  end try
  if madeDoc then
    try
      close front window
    end try
  end if
  return r
end tell`;

function isOwnList(href, cat) {
  try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'www.athome.co.jp' && u.pathname.startsWith(`/${cat}/estate/062449/list`); }
  catch (_) { return false; }
}
const ids = new Set();
const counts = {};
const failed = [];
for (const cat of LISTS) {
  try {
    const out = execFileSync('osascript', ['-e', OSA(`https://www.athome.co.jp/${cat}/estate/062449/list/`)],
      { encoding: 'utf8', timeout: 60000 }).trim();
    const [list, href, title] = out.split('#');
    // ブロック画面・ログイン画面・別ページを「成功」にしない: URLが自社(062449)の該当一覧で、タイトルに会社名があること
    if (out.startsWith('ERR') || !isOwnList(href, cat) || !/明治不動産/.test(title || '')) throw new Error(`unexpected page: ${String(href).slice(0, 60)} / ${String(title).slice(0, 30)}`);
    const found = list ? list.split('|').filter(Boolean) : [];
    found.forEach(x => ids.add(x));
    counts[cat] = found.filter(x => x.startsWith(cat + ':')).length;
  } catch (e) {
    failed.push(`${cat}: ${String(e).slice(0, 60)}`);
  }
}

// 安全則: ベースラインに数値IDの在庫があるカテゴリで0件 = 「全部成約」でなく取得不能(ブロック/描画失敗)とみなす
const baseline = {};
try {
  const lst = JSON.parse(fs.readFileSync(path.join(__dirname, 'athome-listings.json'), 'utf8'));
  lst.listings.forEach(l => {
    if (/^\d{8,}$/.test(String(l.athome_id))) baseline[l.category] = (baseline[l.category] || 0) + 1;
  });
} catch (e) { failed.push('baseline unreadable: ' + String(e).slice(0, 60)); }
for (const cat of LISTS) {
  if ((baseline[cat] || 0) > 0 && !(counts[cat] > 0)) failed.push(`${cat}: baseline=${baseline[cat]} but fetched ${counts[cat] || 0} (suspected block/render)`);
}
if (failed.length) { console.error('FETCH FAILED: ' + failed.join(' / ')); process.exit(2); }
[...ids].sort().forEach(x => console.log(x));
console.error('fetched: ' + JSON.stringify(counts));
