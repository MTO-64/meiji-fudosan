#!/usr/bin/env node
/* athome の自社(062449)リストページ6種から掲載中の物件IDを取得し、1行1IDで stdout に出す。
 * curl は bot-block されるため Playwright(headless) を使う。
 * exit 0: 全カテゴリ取得成功 / exit 2: 取得失敗（黙って成功扱いにしない） */
const { chromium } = require('playwright');

const LISTS = ['tochi', 'kodate', 'buy_store', 'chintai', 'rent_store', 'rent_office'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ userAgent: UA })).newPage();
  const ids = new Set();
  const counts = {};
  let failed = [];
  for (const cat of LISTS) {
    try {
      await page.goto(`https://www.athome.co.jp/${cat}/estate/062449/list/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await page.waitForTimeout(1500);
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map(a => (a.getAttribute('href').match(/\/(?:tochi|kodate|buy_store|chintai|rent_store|rent_office)\/(\d{10})\//) || [])[1])
          .filter(Boolean)
      );
      found.forEach(id => ids.add(`${cat}:${id}`));
      counts[cat] = new Set(found).size;
    } catch (e) {
      failed.push(`${cat}: ${String(e).slice(0, 60)}`);
    }
  }
  await browser.close();
  // 安全則: ベースラインに在庫があるカテゴリで0件 = 「全部成約」でなく取得不能とみなす
  // （headless への選別ブロックを誤って差分と報告しない）
  let baseline = {};
  try {
    const fs = require('fs');
    const path = require('path');
    const lst = JSON.parse(fs.readFileSync(path.join(__dirname, 'athome-listings.json'), 'utf8'));
    lst.listings.forEach(l => {
      if (l.category && !String(l.id || l.athome_id || '').startsWith('rent_office_')) {
        baseline[l.category] = (baseline[l.category] || 0) + 1;
      }
    });
  } catch (_) {}
  for (const cat of LISTS) {
    if ((baseline[cat] || 0) > 0 && (counts[cat] || 0) === 0 && !failed.some(f => f.startsWith(cat))) {
      failed.push(`${cat}: baseline=${baseline[cat]} but fetched 0 (suspected block)`);
    }
  }
  if (failed.length > 0) {
    console.error('FETCH FAILED: ' + failed.join(' / '));
    process.exit(2);
  }
  [...ids].sort().forEach(x => console.log(x));
  process.exit(0);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(2); });
