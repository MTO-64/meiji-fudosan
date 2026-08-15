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

// **判定できる場所を宣言する**(2026-08-15・別PJで踏んだ実害を持ち込んだ)。
// この床は「リポジトリを見れば分かること」と「この端末の運用状態」の2種類を混ぜていた。
// 混ざったままCI(GitHub Actions)に繋ぐと、運用側は判定不能so**永久に赤**になり、
// 「正常な作業を止める床」として必ず外される。外された床は無いのと同じ。
// so scope を分ける:
//   repo … リポジトリの中身だけで判定できる。**公開前の関門(CI)で必ず通す**
//   all  … repo + この端末にしか無い状態(launchd登録)。既定・ローカル実行はこれ
// **中途半端に3値にしない**(Codex指摘)。`ops` 単独を用意しても repo 側の判定を
// 全部条件分岐させない限り実体は `all` と同じで、**名前だけが契約を偽る**。要るのは2つ。
//
// **振り分けを間違えると「偽の緑」を作る**(2026-08-15 Codex指摘で是正)。
// 最初 athome掲載情報の鮮度を ops に入れたが、**そのJSONはリポジトリにコミットされている**so
// どこでも判定できる。opsに入れた結果、**63日前のデータがCIで緑になっていた**＝
// 今日いちばんやってはいけない形（未検査を「問題なし」と読ませる）を自分でやっていた。
const SCOPE = process.env.SITE_HEALTH_SCOPE || 'all';   // repo | all
if (!['repo', 'all'].includes(SCOPE)) {
  console.error(`✖ SITE_HEALTH_SCOPE が不正: "${SCOPE}"（repo | all）`);
  process.exit(64);
}

// **全ての検査を先に登録し、最後に「全部が結末を持ったか」を確かめる**(2026-08-15 Codex指摘)。
// 「判定しなかったものは必ず挙げる」と書いたのに、**上流のファイルが無いと下流の検査が
// 評価もskip表示もされず消えていた**（3度目の同じ契約漏れ）。個別に書き足すと必ずまた漏れるso
// 「登録された検査は PASS / FAIL / SKIP のどれか一度で終わる」を機械で強制する。
const EXPECTED = [
  '物件データがスキーマ検証を通る',
  'athome掲載情報がある',
  'athome掲載情報に取得日がある',
  `athome掲載情報が${STALE_DAYS}日以内`,
  '物件の成約チェックの自動実行',
  '物件個別ページのディレクトリがある',
  '個別ページが掲載データに全部対応している',
  '個別ページが一覧から辿れる',
  '物件データファイルがある',
  '公開中の物件が1件以上ある',
  '公開中の物件に価格がある',
];
const settled = new Map();   // 名前 → 'PASS' | 'FAIL' | 'SKIP'

let fails = 0;
const skipped = [];
const t = (name, ok, detail = '') => {
  settled.set(name, ok ? 'PASS' : 'FAIL');
  if (ok) console.log(`ok: ${name}`);
  else { fails++; console.error(`FAIL: ${name}${detail ? `\n  ${detail}` : ''}`); }
};
/** この scope では判定できない項目。**黙って飛ばさず、必ず名前を残す。** */
const skip = (name, why) => { settled.set(name, 'SKIP'); skipped.push(`${name}（${why}）`); };
const inScope = (kind) => SCOPE === 'all' || SCOPE === kind;   // kind='ops' は all の時だけ真

// ── ① トップに出る物件データが壊れていない(既存の検証スクリプトをそのまま通す) ──
// スキーマ検証を自前で再実装しないための呼び出し。
// **ただしこれは「本番経路を通った」ことにはならない**(2026-08-15 Codex指摘・誤解を招くので明記):
// index.html が properties-data.js を読んでカードを描く経路も、build-bukken.js の生成も、
// デプロイ済みサイトとローカルの一致も、この床は見ていない。見ているのはデータの形と鮮度だけ。
try {
  const out = execFileSync('node', [join(ROOT, 'scripts/validate-properties.mjs')],
    { cwd: ROOT, encoding: 'utf8' });
  t('物件データがスキーマ検証を通る', true, out.trim());
} catch (e) {
  t('物件データがスキーマ検証を通る', false, String(e.stdout || e.message).trim());
}

// ── ② athomeの掲載情報が古すぎないか ──
// **鮮度はリポジトリの中身so repo 判定**。CIで緑にすると、成約済み物件が載り続ける状態で公開が通る。
const listingsPath = join(ROOT, 'scripts/athome-listings.json');
// **在る側も必ず記録する**(2026-08-15 「消えた検査」検出で発覚)。
// 無い時だけ t() を呼ぶ書き方は、在る時に何も残らない＝結末を持たない検査になる。
t('athome掲載情報がある', existsSync(listingsPath), listingsPath);
if (existsSync(listingsPath)) {
  const listings = JSON.parse(readFileSync(listingsPath, 'utf8'));
  const scraped = listings.scraped_at ? new Date(listings.scraped_at) : null;
  t('athome掲載情報に取得日がある', !!scraped && !Number.isNaN(scraped.getTime()), `scraped_at=${listings.scraped_at}`);
  if (scraped && !Number.isNaN(scraped.getTime())) {
    const days = Math.floor((Date.now() - scraped.getTime()) / 86400e3);
    // 未来日をPASSにしない(Codex指摘)。日付を打ち間違えると負の日数になり、床が黙る。
    t(`athome掲載情報が${STALE_DAYS}日以内`, days >= 0 && days <= STALE_DAYS,
      `${days}日前(${listings.scraped_at})の情報でサイトが動いている\n` +
      `  → 成約・取り下げになった物件が載り続けている可能性。\n` +
      `  → 直し方: bash scripts/athome-sync-check.sh を走らせて差分を確認する`);
  }

}

// ── ③ 同期チェックが実際に走っているか(「スクリプトがある」は動いている証拠にならない) ──
// 2026-08-14に実話chで、plistはあるのにジョブが消えて5回の実行が飛んだ事故を踏んでいる。
// so「設定を見る」のではなく「最後に走った形跡を見る」。
// **②の存在確認の中に入れない**(Codex指摘)。掲載JSONが無いと、独立しているはずのこの判定が
// 評価もskip表示もされず消えていた＝「判定しなかったものは必ず挙げる」の例外を自分で作っていた。
if (!inScope('ops')) {
  skip('物件の成約チェックの自動実行', 'launchdはこの端末にしか無いのでCIでは判定できない');
} else {
  const HOMEDIR = process.env.HOME || '';
  const syncLog = HOMEDIR && join(HOMEDIR, '.claude/logs/meiji-athome-sync.log');
  const installed = !!HOMEDIR && existsSync(join(HOMEDIR, 'Library/LaunchAgents/com.mto.meiji-athome-sync.plist'));
  const draft = existsSync(join(ROOT, 'scripts/com.mto.meiji-athome-sync.plist.DRAFT'));
  t('物件の成約チェックの自動実行',
    installed && !!syncLog && existsSync(syncLog),
    `launchd登録=${installed ? 'あり' : 'なし'} / 実行ログ=${syncLog && existsSync(syncLog) ? 'あり' : 'なし'}` +
    (draft && !installed ? '\n  → plistが .DRAFT のまま。作ってあるが配線されていない(=一度も走っていない)' : '') +
    '\n  → 直し方: cp scripts/com.mto.meiji-athome-sync.plist.DRAFT ~/Library/LaunchAgents/com.mto.meiji-athome-sync.plist' +
    ' && plutil -lint ... && launchctl load ...(外部サイトへ定期アクセスするのでownerの承認が要る)');
}

// ── ④ 物件個別ページと掲載データの件数が食い違っていないか ──
// 検査対象が丸ごと消えたら、検査ブロックを黙って飛ばさずFAILにする(Codex指摘)。
// 「無くなったから検査しない」は、一番壊れている時に一番静かになる。
const bukkenDir = join(ROOT, 'bukken');
t('物件個別ページのディレクトリがある', existsSync(bukkenDir), bukkenDir);
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
t('物件データファイルがある', existsSync(propsPath), propsPath);
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

// **登録した検査が全部「結末」を持ったか**。上流が落ちて下流が消えるのを、ここで必ず捕まえる。
const missing = EXPECTED.filter((n) => !settled.has(n));
if (missing.length) {
  fails += missing.length;
  console.error(`\nFAIL: 評価も skip もされずに消えた検査が ${missing.length}件`);
  for (const m of missing) console.error(`  ・${m}`);
  console.error('  → 上流の前提(ファイルの存在・parse成功)が崩れると、下流の検査が黙って消える。');
  console.error('    **消えた検査を「異常なし」と読ませない**ためにここで赤にする。');
}

// **見ていない範囲を必ず言う**。黙って飛ばした項目を「異常なし」と読ませない。
if (skipped.length) {
  console.log(`\nこの実行で判定していない項目 (SITE_HEALTH_SCOPE=${SCOPE}):`);
  for (const s2 of skipped) console.log(`  ・${s2}`);
}
if (fails) { console.error(`\n${fails}件FAIL`); process.exit(1); }
console.log('\n全PASS');
