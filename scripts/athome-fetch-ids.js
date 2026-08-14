#!/usr/bin/env node
/* athome の自社(062449)リストページ6種から掲載中の物件IDを取得し「カテゴリ:ID」を1行ずつ stdout に出す。
 * curl・クリーンコンテキストは bot-block(Reese84)されるため、永続プロファイル
 * (.athome-profile/ — 初回実行でCookieが温まり以後再利用)の Playwright を使う。
 * exit 0: 取得成功 / exit 2: 取得失敗（黙って成功扱いにしない） */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// chintai(賃貸住宅) は athome 旧UIで個別物件URLが javascript:void(0) になり ID を取れないため
// ID監視の対象外。売買と貸店舗/事務所の鮮度監視を主目的とする。
const LISTS = ['tochi', 'kodate', 'buy_store', 'rent_store', 'rent_office'];
const SHOP = 'https://www.athome.co.jp/ahch/meijihudousan.html';
// 温まった(Reese84チャレンジ通過済み)プロファイルを使う。新規プロファイルは初回チャレンジで
// 弾かれるため、既存の温済みプロファイルを指す。ENV で上書き可。
// launchd ではブラウザ非使用時間帯に回す（同一プロファイルの同時起動は排他ロックで fail→検知される）。
const PROFILE = process.env.ATHOME_PROFILE || path.join(process.env.HOME, '.claude', 'playwright-profile');
// athome は headless ブラウザのフィンガープリントを Reese84 で弾くため、デフォルト headful。
// launchd からも headful で起動する（substack 自動化と同じ方式・実績あり）。
const HEADLESS = process.env.ATHOME_HEADLESS ? true : false;

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const ids = new Set();
  const counts = {};
  const failed = [];

  // チャレンジのリダイレクトで初回 goto が ERR_ABORTED になることがあるため1回リトライする。
  const gotoWithRetry = async (url) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      await page.waitForTimeout(7000);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
  };

  // ウォームアップ: トップ → 自社店舗ページの順に踏み、bot チャレンジ(Reese84)を通して
  // リファラ連鎖を作る。list ページへ直アクセスすると ERR_ABORTED で弾かれるため必須。
  try {
    await gotoWithRetry('https://www.athome.co.jp/');
    await page.waitForTimeout(6000);
    await gotoWithRetry(SHOP);
    await page.waitForTimeout(3000);
  } catch (_) { await page.waitForTimeout(6000); }

  for (const cat of LISTS) {
    try {
      await gotoWithRetry(`https://www.athome.co.jp/${cat}/estate/062449/list/`);
      try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (_) {}
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(2500);
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map(a => a.href)
          .map(h => (h.match(/athome\.co\.jp\/(tochi|kodate|buy_store|chintai|rent_store|rent_office)\/(\d{8,12})\//) || []))
          .filter(m => m.length)
          .map(m => `${m[1]}:${m[2]}`)
      );
      found.forEach(x => ids.add(x));
      counts[cat] = new Set(found.filter(x => x.startsWith(cat + ':'))).size;
    } catch (e) {
      failed.push(`${cat}: ${String(e).slice(0, 60)}`);
    }
  }
  await ctx.close();

  // 安全則: ベースラインに在庫があるカテゴリで0件 = 「全部成約」でなく取得不能とみなす
  let baseline = {};
  try {
    const lst = JSON.parse(fs.readFileSync(path.join(__dirname, 'athome-listings.json'), 'utf8'));
    lst.listings.forEach(l => {
      const id = String(l.athome_id || '');
      if (l.category && /^\d+$/.test(id)) baseline[l.category] = (baseline[l.category] || 0) + 1;
    });
  } catch (_) {}
  for (const cat of LISTS) {
    if ((baseline[cat] || 0) > 0 && (counts[cat] || 0) === 0 && !failed.some(f => f.startsWith(cat))) {
      failed.push(`${cat}: baseline=${baseline[cat]} but fetched 0 (suspected block/render)`);
    }
  }
  if (failed.length > 0) {
    console.error('FETCH FAILED: ' + failed.join(' / '));
    process.exit(2);
  }
  [...ids].sort().forEach(x => console.log(x));
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(2); });
