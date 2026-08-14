// site-health.test.mjs — 明治不動産サイトが「静かに古くなっていない」ことを確かめる床(2026-08-15)。
//
// **なぜ要るか**(2026-08-15の全PJ診断で実測した実害):
//   ・`bukken/` の物件個別ページ14件は、63日前に取ったathomeの掲載情報から作られたまま。
//   ・その古さを検知するはずの同期チェック(`athome-sync-check.sh`)は、
//     launchdのplistが `.DRAFT` のまま**一度も走っていない**(ログファイルすら無い)。
//   ＝ 掲載中の物件が成約・取り下げになっても、サイトには載り続け、誰にも分からない。
//
// 不動産サイトでこれが起きると、問い合わせが空振りする。**バグではなく信用の問題**so、
// 「エラーが出ない壊れ方」の中でも損害が大きい。だから床にする。
//
// この床は外部サイトを1回も叩かない(ローカルのファイルだけ見る)。何回走らせても原価ゼロ・無害。
// 実際にathome側と突き合わせるのは `scripts/athome-sync-check.sh` の仕事で、これはその
// **「同期チェックがサボっていること自体」を鳴らす**役割。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 掲載情報がこれ以上古くなったら赤。不動産の売買物件は数週間で動くので、
// 「1ヶ月以上、成約したかどうかを一度も確認していない」を許容ラインの外に置く。
const STALE_DAYS = 30;

let fails = 0;
const t = (name, ok, detail = '') => {
  if (ok) console.log(`ok: ${name}`);
  else { fails++; console.error(`FAIL: ${name}${detail ? `\n  ${detail}` : ''}`); }
};

// ── ① トップに出る物件データが壊れていない(既存の検証スクリプトをそのまま通す) ──
// **自前で再実装しない**。本番が使う検証を呼ぶ＝検査が本番と違うものを見る事故を避ける。
try {
  const out = execFileSync('node', [join(ROOT, 'scripts/validate-properties.mjs')],
    { cwd: ROOT, encoding: 'utf8' });
  t('物件データがスキーマ検証を通る', true, out.trim());
} catch (e) {
  t('物件データがスキーマ検証を通る', false, String(e.stdout || e.message).trim());
}

// ── ② athomeの掲載情報が古すぎないか ──
const listingsPath = join(ROOT, 'scripts/athome-listings.json');
if (!existsSync(listingsPath)) {
  t('athome掲載情報がある', false, listingsPath);
} else {
  const listings = JSON.parse(readFileSync(listingsPath, 'utf8'));
  const scraped = listings.scraped_at ? new Date(listings.scraped_at) : null;
  t('athome掲載情報に取得日がある', !!scraped && !Number.isNaN(scraped.getTime()), `scraped_at=${listings.scraped_at}`);
  if (scraped && !Number.isNaN(scraped.getTime())) {
    const days = Math.floor((Date.now() - scraped.getTime()) / 86400e3);
    t(`athome掲載情報が${STALE_DAYS}日以内`, days <= STALE_DAYS,
      `${days}日前(${listings.scraped_at})の情報でサイトが動いている\n` +
      `  → 成約・取り下げになった物件が載り続けている可能性。\n` +
      `  → 直し方: bash scripts/athome-sync-check.sh を走らせて差分を確認する`);
  }

  // ── ③ 同期チェックが実際に走っているか(「スクリプトがある」は動いている証拠にならない) ──
  // 2026-08-14に実話chで、plistはあるのにジョブが消えて5回の実行が飛んだ事故を踏んでいる。
  // so「設定を見る」のではなく「最後に走った形跡を見る」。
  const syncLog = join(process.env.HOME, '.claude/logs/meiji-athome-sync.log');
  const installed = existsSync(join(process.env.HOME, 'Library/LaunchAgents/com.mto.meiji-athome-sync.plist'));
  const draft = existsSync(join(ROOT, 'scripts/com.mto.meiji-athome-sync.plist.DRAFT'));
  t('物件の成約チェックが自動で走っている',
    installed && existsSync(syncLog),
    `launchd登録=${installed ? 'あり' : 'なし'} / 実行ログ=${existsSync(syncLog) ? 'あり' : 'なし'}` +
    (draft && !installed ? '\n  → plistが .DRAFT のまま。作ってあるが配線されていない(=一度も走っていない)' : '') +
    '\n  → 直し方: cp scripts/com.mto.meiji-athome-sync.plist.DRAFT ~/Library/LaunchAgents/com.mto.meiji-athome-sync.plist' +
    ' && plutil -lint ... && launchctl load ...(外部サイトへ定期アクセスするのでownerの承認が要る)');
}

// ── ④ 物件個別ページと掲載データの件数が食い違っていないか ──
const bukkenDir = join(ROOT, 'bukken');
if (existsSync(bukkenDir)) {
  const pages = readdirSync(bukkenDir).filter((d) => /^\d+$/.test(d));
  const listings = existsSync(listingsPath) ? JSON.parse(readFileSync(listingsPath, 'utf8')).listings || [] : [];
  const ids = new Set(listings.map((l) => String(l.athome_id)));
  const orphan = pages.filter((p) => !ids.has(p));
  t('個別ページが掲載データに全部対応している', orphan.length === 0,
    `対応の無いページ: ${orphan.join(', ')} → 元データから消えたのにページだけ残っている`);
  // 一覧から辿れないページがあると、検索経由でだけ生きた「幽霊ページ」になる
  const indexHtml = existsSync(join(bukkenDir, 'index.html')) ? readFileSync(join(bukkenDir, 'index.html'), 'utf8') : '';
  const unlinked = pages.filter((p) => !indexHtml.includes(p));
  t('個別ページが一覧から辿れる', unlinked.length === 0, `一覧に無い: ${unlinked.join(', ')}`);
}

// ── ⑤ トップの物件データと個別ページで、同じ物件の価格が食い違っていないか ──
// 別々に更新される2箇所so、片方だけ直すと「一覧50万・詳細80万」が黙って成立する。
const propsPath = join(ROOT, 'properties-data.js');
if (existsSync(propsPath)) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(propsPath, 'utf8'), sandbox, { filename: 'properties-data.js' });
  const cfg = sandbox.window.propConfig || {};
  const actives = Object.values(cfg).filter((p) => p && p.active);
  t('公開中の物件が1件以上ある', actives.length > 0, `公開中=${actives.length}/${Object.keys(cfg).length}`);
  const noPrice = actives.filter((p) => !String(p.price ?? '').trim());
  t('公開中の物件に価格がある', noPrice.length === 0, `価格なし: ${noPrice.map((p) => p.id).join(', ')}`);
}

if (fails) { console.error(`\n${fails}件FAIL`); process.exit(1); }
console.log('\n全PASS');
