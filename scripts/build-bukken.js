'use strict';

/**
 * build-bukken.js
 * 静的ジェネレータ: athome-details.json → bukken/ 個別ページ + bukken/index.html + sitemap.xml更新 + エリアページ差し込み
 * 依存ゼロ・冪等
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(__dirname, 'athome-details.json');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const LASTMOD = '2026-06-13';

// URLからathome_idとカテゴリを取得
function parseUrl(url) {
  const m = url.match(/athome\.co\.jp\/(tochi|kodate|buy_store|chintai|rent_store|rent_office)\/(\d+)\//);
  if (!m) return null;
  return { category: m[1], athome_id: m[2] };
}

// 種別→日本語表示・絵文字・カラー
function getTypeInfo(spec) {
  const use = spec['最適用途'] || spec['物件種目'] || '';
  if (/工場/.test(use)) return { label: '売土地（工場用地）', emoji: '🏭', bg: '#2d3748', accent: '#fc8181' };
  if (/事業/.test(use)) return { label: '売土地（事業用地）', emoji: '🏢', bg: '#1a365d', accent: '#63b3ed' };
  if (/住宅/.test(use)) return { label: '売土地', emoji: '🌿', bg: '#1c4532', accent: '#68d391' };
  if (/店舗/.test(use) || /売店舗/.test(spec['物件種目'] || '')) return { label: '売店舗', emoji: '🏪', bg: '#3c2005', accent: '#f6ad55' };
  if (/中古/.test(spec['物件種目'] || '') || /戸建/.test(spec['物件種目'] || '')) return { label: '中古戸建て', emoji: '🏠', bg: '#1a202c', accent: '#f6e05e' };
  return { label: '売物件', emoji: '🏡', bg: '#2a2a2a', accent: '#d4af37' };
}

// 市町からエリアパスを取得
function getCityAreaPath(city) {
  const map = {
    '石岡市': '/ishioka/',
    '小美玉市': '/omitama/',
    'かすみがうら市': '/kasumigaura/',
    '土浦市': '/tsuchiura/',
    '笠間市': '/kasama/',
    'つくば市': '/tsukuba/',
    '鉾田市': '/hokota/',
  };
  return map[city] || '/ibaraki/';
}

// 市町名（表示用）
function getCityName(city) {
  return city || '茨城県';
}

// タイトル用の短い所在地（市町+町名）
function getShortAddress(spec) {
  const addr = spec['所在地'] || '';
  // 「茨城県石岡市東石岡４丁目」→「石岡市東石岡４丁目」
  return addr.replace(/^茨城県/, '');
}

// HTML エスケープ
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ヘッダー/ナビ HTML（全ページ共通）
function renderHeader() {
  return `<header>
  <div class="header-inner">
    <div class="logo">
      <a href="/">
        <span class="logo-en">MEIJI REAL ESTATE</span>
        <span class="logo-ja">株式会社明治不動産</span>
      </a>
    </div>
    <nav>
      <a href="/">トップ</a>
      <a href="/ishioka/">石岡市</a>
      <a href="/omitama/">小美玉市</a>
      <a href="/bukken/">物件一覧</a>
      <a href="/baikyaku/">売却・査定</a>
      <a href="/#contact" class="nav-cta">無料相談</a>
    </nav>
  </div>
</header>`;
}

// フッター HTML（全ページ共通）
function renderFooter() {
  return `<footer>
  <div class="footer-inner">
    <div>
      <h3>株式会社明治不動産</h3>
      <p>〒315-0014<br>茨城県石岡市国府1丁目2-2<br>TEL：0299-35-2123<br>営業時間：10:00〜18:00（日曜・祝日休み）</p>
    </div>
    <div>
      <h3>エリア</h3>
      <ul>
        <li><a href="/ishioka/">石岡市</a></li>
        <li><a href="/omitama/">小美玉市</a></li>
        <li><a href="/kasumigaura/">かすみがうら市</a></li>
        <li><a href="/tsuchiura/">土浦市</a></li>
        <li><a href="/kasama/">笠間市</a></li>
        <li><a href="/ibaraki/">対応エリア</a></li>
      </ul>
    </div>
    <div>
      <h3>物件</h3>
      <ul>
        <li><a href="/bukken/">販売中の物件一覧</a></li>
        <li><a href="/baikyaku/">不動産売却・無料査定</a></li>
        <li><a href="/ishioka/akiya/">空き家</a></li>
        <li><a href="/ishioka/business-land/">事業用地</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">© 株式会社明治不動産 / 茨城県知事免許(3) 第6811号</div>
</footer>`;
}

// 共通CSS（個別ページ用・インライン）
function renderDetailCSS() {
  return `<style>
  :root {
    --gold: #b8960c;
    --gold-light: #d4af37;
    --gold-pale: #f5e9c0;
    --dark: #1a1a1a;
    --dark2: #242424;
    --dark3: #2e2e2e;
    --white: #ffffff;
    --off-white: #f8f6f2;
    --text: #333333;
    --muted: #777777;
    --border: #e0d8c8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { font-family: 'Noto Sans JP', sans-serif; color: var(--text); background: var(--white); overflow-x: hidden; }

  header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    background: rgba(26,26,26,0.96); backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(184,150,12,0.3);
  }
  .header-inner {
    max-width: 1200px; margin: 0 auto; padding: 0 24px;
    height: 72px; display: flex; align-items: center; justify-content: space-between;
  }
  .logo { display: flex; flex-direction: column; line-height: 1.2; }
  .logo a { text-decoration: none; }
  .logo-en { font-size: 10px; letter-spacing: 4px; color: var(--gold-light); font-weight: 300; }
  .logo-ja { font-family: 'Noto Serif JP', serif; font-size: 18px; font-weight: 700; color: var(--white); letter-spacing: 2px; }
  nav { display: flex; gap: 32px; }
  nav a { color: rgba(255,255,255,0.8); text-decoration: none; font-size: 13px; letter-spacing: 1px; transition: color 0.2s; }
  nav a:hover { color: var(--gold-light); }
  nav .nav-cta { background: var(--gold); color: var(--white); padding: 8px 20px; border-radius: 4px; }
  nav .nav-cta:hover { background: var(--gold-light); }

  .breadcrumb {
    padding: 88px 24px 8px; max-width: 1200px; margin: 0 auto;
    font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px;
  }
  .breadcrumb a { color: var(--muted); text-decoration: none; }
  .breadcrumb a:hover { color: var(--gold); }
  .breadcrumb-sep { color: var(--border); }

  .bukken-hero {
    padding: 24px 24px 40px; max-width: 1200px; margin: 0 auto;
  }
  .hero-band {
    border-radius: 12px; padding: 40px 48px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .hero-emoji { font-size: 48px; line-height: 1; }
  .hero-type { font-size: 13px; letter-spacing: 2px; opacity: 0.8; font-weight: 300; }
  .hero-price { font-family: 'Noto Serif JP', serif; font-size: 40px; font-weight: 700; line-height: 1.2; }
  .hero-address { font-size: 16px; opacity: 0.9; margin-top: 4px; }

  .bukken-main { max-width: 1200px; margin: 0 auto; padding: 0 24px 64px; }

  .spec-section { margin-bottom: 40px; }
  .spec-section h2 { font-family: 'Noto Serif JP', serif; font-size: 20px; font-weight: 600; color: var(--dark); border-left: 3px solid var(--gold); padding-left: 12px; margin-bottom: 16px; }
  .spec-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .spec-table tr { border-bottom: 1px solid var(--border); }
  .spec-table th { width: 36%; padding: 10px 12px; background: var(--off-white); color: var(--muted); font-weight: 500; text-align: left; vertical-align: top; }
  .spec-table td { padding: 10px 12px; color: var(--text); vertical-align: top; line-height: 1.6; }

  .biko-box { background: var(--off-white); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; font-size: 14px; line-height: 1.8; color: var(--text); }

  .notice-box { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px 16px; font-size: 12px; color: #92400e; margin-bottom: 32px; }

  .cta-block { background: var(--dark); color: var(--white); border-radius: 12px; padding: 40px; text-align: center; margin-bottom: 40px; }
  .cta-block h2 { font-family: 'Noto Serif JP', serif; font-size: 22px; font-weight: 600; margin-bottom: 12px; }
  .cta-block p { color: rgba(255,255,255,0.75); font-size: 14px; margin-bottom: 24px; line-height: 1.7; }
  .cta-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn-primary { background: var(--gold); color: var(--white); padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background 0.2s; }
  .btn-primary:hover { background: var(--gold-light); }
  .btn-secondary { border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.8); padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 14px; transition: border-color 0.2s; }
  .btn-secondary:hover { border-color: var(--gold-light); color: var(--gold-light); }

  .related-links { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; }
  .related-links a { color: var(--gold); text-decoration: none; font-size: 13px; border: 1px solid var(--border); padding: 8px 16px; border-radius: 4px; transition: background 0.2s; }
  .related-links a:hover { background: var(--off-white); }

  footer { background: var(--dark); color: rgba(255,255,255,0.7); padding: 48px 24px 24px; margin-top: 0; }
  .footer-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding-bottom: 32px; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .footer-inner h3 { font-family: 'Noto Serif JP', serif; font-size: 14px; color: var(--white); margin-bottom: 12px; }
  .footer-inner p { font-size: 12px; line-height: 1.8; }
  .footer-inner ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .footer-inner ul li a { color: rgba(255,255,255,0.6); text-decoration: none; font-size: 12px; }
  .footer-inner ul li a:hover { color: var(--gold-light); }
  .footer-bottom { text-align: center; font-size: 11px; color: rgba(255,255,255,0.3); padding-top: 20px; max-width: 1200px; margin: 0 auto; }

  @media (max-width: 768px) {
    nav { display: none; }
    .hero-band { padding: 28px 24px; }
    .hero-price { font-size: 28px; }
    .footer-inner { grid-template-columns: 1fr; gap: 24px; }
    .spec-table th { width: 40%; font-size: 13px; }
    .spec-table td { font-size: 13px; }
    .cta-buttons { flex-direction: column; }
    .btn-primary, .btn-secondary { text-align: center; }
  }
</style>`;
}

// 個別ページHTML生成
function buildDetailPage(item, athome_id) {
  const spec = item.spec || {};
  const parsed = parseUrl(item.url);
  const category = parsed ? parsed.category : 'tochi';

  // city取得
  const addrFull = spec['所在地'] || '';
  let city = '';
  const cityMatch = addrFull.match(/(?:石岡市|小美玉市|かすみがうら市|土浦市|笠間市|つくば市|鉾田市|行方市|水戸市)/);
  if (cityMatch) city = cityMatch[0];

  const shortAddr = getShortAddress(spec);
  const typeInfo = getTypeInfo(spec);
  const price = spec['価格'] || '';
  const use = spec['最適用途'] || spec['物件種目'] || '';

  // title: 「{市町}{町名} {種別} {価格}｜株式会社明治不動産」
  const pageTitle = `${esc(shortAddr)} ${esc(typeInfo.label)} ${esc(price)}｜株式会社明治不動産`;

  // description: spec要約+TEL
  const descParts = [];
  if (shortAddr) descParts.push(shortAddr);
  if (typeInfo.label) descParts.push(typeInfo.label);
  if (price) descParts.push(price);
  if (spec['土地面積']) descParts.push(`土地${spec['土地面積']}`);
  if (spec['建物面積']) descParts.push(`建物${spec['建物面積']}`);
  const description = `${descParts.join('、')}。株式会社明治不動産の取り扱い物件。TEL：0299-35-2123`;

  const canonicalUrl = `https://meijifudosan.com/bukken/${athome_id}/`;
  const areaPath = getCityAreaPath(city);
  const areaName = getCityName(city);

  // specの全項目からスペック表を生成
  // 取引態様は item['取引態様'] から
  const torihikiTaiyo = item['取引態様'];

  const specRows = [];
  const skipKeys = []; // すべて表示
  const specOrder = [
    '所在地', '交通', '物件種目', '価格', '坪単価',
    '土地面積', '建物面積', '間取り', '築年月',
    '最適用途', '土地権利', '用途地域', '建ぺい率', '容積率',
    '接道状況', '引渡し（可能時期/方法）', '情報公開日', '駐車場'
  ];

  // 規定順で表示し、残りは後ろに
  const shownKeys = new Set();
  for (const key of specOrder) {
    if (spec[key] !== undefined) {
      specRows.push(`<tr><th>${esc(key)}</th><td>${esc(spec[key])}</td></tr>`);
      shownKeys.add(key);
    }
  }
  for (const key of Object.keys(spec)) {
    if (!shownKeys.has(key) && key !== '備考') {
      specRows.push(`<tr><th>${esc(key)}</th><td>${esc(spec[key])}</td></tr>`);
    }
  }
  // 取引態様を追加
  specRows.push(`<tr><th>取引態様</th><td>${torihikiTaiyo !== null ? esc(torihikiTaiyo) : '－'}</td></tr>`);

  const bikoText = spec['備考'];
  const hasAtHome = item.url && item.url.includes('athome.co.jp');

  // ld+json RealEstateListing
  const ldPrice = price.replace(/[^0-9]/g, '');
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: `${shortAddr} ${typeInfo.label}`,
    description: description,
    url: canonicalUrl,
    address: {
      '@type': 'PostalAddress',
      streetAddress: addrFull.replace(/^茨城県/, ''),
      addressLocality: city,
      addressRegion: '茨城県',
      addressCountry: 'JP'
    },
    offers: ldPrice ? {
      '@type': 'Offer',
      price: ldPrice,
      priceCurrency: 'JPY'
    } : undefined
  };
  if (!ldJson.offers) delete ldJson.offers;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'トップ', item: 'https://meijifudosan.com/' },
      { '@type': 'ListItem', position: 2, name: '物件一覧', item: 'https://meijifudosan.com/bukken/' },
      { '@type': 'ListItem', position: 3, name: `${shortAddr} ${typeInfo.label}`, item: canonicalUrl }
    ]
  };

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7YHR1QE05T"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7YHR1QE05T');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
<meta name="author" content="株式会社明治不動産">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="株式会社明治不動産">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(pageTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
${renderDetailCSS()}
</head>
<body>

${renderHeader()}

<nav class="breadcrumb" aria-label="パンくずリスト">
  <a href="/">トップ</a>
  <span class="breadcrumb-sep">›</span>
  <a href="/bukken/">物件一覧</a>
  <span class="breadcrumb-sep">›</span>
  <span>${esc(shortAddr)} ${esc(typeInfo.label)}</span>
</nav>

<div class="bukken-hero">
  <div class="hero-band" style="background:${typeInfo.bg};color:${typeInfo.accent};">
    <div class="hero-emoji">${typeInfo.emoji}</div>
    <div class="hero-type">${esc(typeInfo.label)}</div>
    <div class="hero-price">${esc(price)}</div>
    <div class="hero-address" style="color:rgba(255,255,255,0.85);">${esc(shortAddr)}</div>
  </div>
</div>

<main class="bukken-main">

<div class="notice-box">
  情報は掲載時点のものです。最新の状況はお問い合わせください。最終確認日: 2026-06-13
</div>

<div class="spec-section">
<h2>物件概要</h2>
<table class="spec-table">
<tbody>
${specRows.join('\n')}
</tbody>
</table>
</div>

${bikoText && bikoText !== '－' ? `<div class="spec-section">
<h2>備考</h2>
<div class="biko-box">${esc(bikoText)}</div>
</div>` : ''}

<div class="cta-block">
  <h2>この物件についてお問い合わせ</h2>
  <p>ご見学のご予約・詳細のご確認など、お気軽にご連絡ください。<br>TEL：0299-35-2123（10:00〜18:00 / 日曜・祝日休み）</p>
  <div class="cta-buttons">
    <a href="tel:0299-35-2123" class="btn-primary">電話で問い合わせ 0299-35-2123</a>
    <a href="/#contact" class="btn-secondary">フォームで問い合わせ</a>
  </div>
</div>

<div class="related-links">
  <a href="/bukken/">← 物件一覧に戻る</a>
  <a href="${areaPath}">${areaName}の不動産情報</a>
  <a href="/baikyaku/">不動産の売却・査定</a>
  ${hasAtHome ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">アットホームで見る</a>` : ''}
</div>

</main>

${renderFooter()}

<script type="application/ld+json">
${JSON.stringify(ldJson, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>

</body>
</html>`;
}

// 一覧ページHTML生成
function buildIndexPage(items) {
  // 市町別グループ（価格順）
  const groups = {};
  for (const { item, athome_id } of items) {
    const spec = item.spec || {};
    const addrFull = spec['所在地'] || '';
    const cityMatch = addrFull.match(/(?:石岡市|小美玉市|かすみがうら市|土浦市|笠間市|つくば市|鉾田市|行方市|水戸市)/);
    const city = cityMatch ? cityMatch[0] : 'その他';
    if (!groups[city]) groups[city] = [];
    groups[city].push({ item, athome_id, city });
  }

  // 市町の表示順
  const cityOrder = ['石岡市', '小美玉市', 'かすみがうら市', '土浦市', '笠間市', 'つくば市', '鉾田市', 'その他'];

  let groupHtml = '';
  for (const city of cityOrder) {
    if (!groups[city] || groups[city].length === 0) continue;
    // 価格順ソート
    const sorted = groups[city].slice().sort((a, b) => {
      const pa = parseInt((a.item.spec['価格'] || '0').replace(/[^0-9]/g, '')) || 0;
      const pb = parseInt((b.item.spec['価格'] || '0').replace(/[^0-9]/g, '')) || 0;
      return pa - pb;
    });

    const cards = sorted.map(({ item, athome_id }) => {
      const spec = item.spec || {};
      const typeInfo = getTypeInfo(spec);
      const price = spec['価格'] || '';
      const shortAddr = getShortAddress(spec);
      const area = spec['土地面積'] || spec['建物面積'] || '';
      return `  <a href="/bukken/${athome_id}/" class="bukken-card" style="background:${typeInfo.bg};color:${typeInfo.accent};">
    <div class="card-emoji">${typeInfo.emoji}</div>
    <div class="card-type">${esc(typeInfo.label)}</div>
    <div class="card-price">${esc(price)}</div>
    <div class="card-addr" style="color:rgba(255,255,255,0.8);">${esc(shortAddr)}</div>
    ${area ? `<div class="card-area" style="color:rgba(255,255,255,0.6);font-size:12px;">${esc(area)}</div>` : ''}
  </a>`;
    }).join('\n');

    groupHtml += `<section class="city-group">
<h2>${esc(city)}</h2>
<div class="bukken-grid">
${cards}
</div>
</section>\n`;
  }

  const total = items.length;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7YHR1QE05T"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7YHR1QE05T');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>販売中の物件一覧（土地・中古戸建・店舗）｜株式会社明治不動産</title>
<meta name="description" content="茨城県石岡市・小美玉市・かすみがうら市・土浦市・笠間市で販売中の物件${total}件。土地・中古一戸建て・売店舗を掲載。株式会社明治不動産 TEL：0299-35-2123">
<meta name="robots" content="index, follow">
<meta name="author" content="株式会社明治不動産">
<link rel="canonical" href="https://meijifudosan.com/bukken/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://meijifudosan.com/bukken/">
<meta property="og:title" content="販売中の物件一覧（土地・中古戸建・店舗）｜株式会社明治不動産">
<meta property="og:description" content="茨城県内の販売中物件${total}件を掲載。株式会社明治不動産 TEL：0299-35-2123">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="株式会社明治不動産">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="販売中の物件一覧（土地・中古戸建・店舗）｜株式会社明治不動産">
<meta name="twitter:description" content="茨城県内の販売中物件${total}件を掲載。株式会社明治不動産">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --gold: #b8960c; --gold-light: #d4af37; --dark: #1a1a1a; --white: #ffffff; --off-white: #f8f6f2; --text: #333333; --muted: #777777; --border: #e0d8c8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans JP', sans-serif; color: var(--text); background: var(--white); overflow-x: hidden; }

  header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    background: rgba(26,26,26,0.96); backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(184,150,12,0.3);
  }
  .header-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 72px; display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; flex-direction: column; line-height: 1.2; }
  .logo a { text-decoration: none; }
  .logo-en { font-size: 10px; letter-spacing: 4px; color: var(--gold-light); font-weight: 300; }
  .logo-ja { font-family: 'Noto Serif JP', serif; font-size: 18px; font-weight: 700; color: var(--white); letter-spacing: 2px; }
  nav { display: flex; gap: 32px; }
  nav a { color: rgba(255,255,255,0.8); text-decoration: none; font-size: 13px; letter-spacing: 1px; transition: color 0.2s; }
  nav a:hover { color: var(--gold-light); }
  nav .nav-cta { background: var(--gold); color: var(--white); padding: 8px 20px; border-radius: 4px; }

  .breadcrumb { padding: 88px 24px 8px; max-width: 1200px; margin: 0 auto; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .breadcrumb a { color: var(--muted); text-decoration: none; }
  .breadcrumb a:hover { color: var(--gold); }
  .breadcrumb-sep { color: var(--border); }

  .page-hero { max-width: 1200px; margin: 0 auto; padding: 24px 24px 32px; }
  .page-hero h1 { font-family: 'Noto Serif JP', serif; font-size: 28px; font-weight: 600; color: var(--dark); margin-bottom: 8px; }
  .page-hero p { color: var(--muted); font-size: 14px; }

  .bukken-index-main { max-width: 1200px; margin: 0 auto; padding: 0 24px 64px; }

  .city-group { margin-bottom: 48px; }
  .city-group h2 { font-family: 'Noto Serif JP', serif; font-size: 20px; font-weight: 600; color: var(--dark); border-left: 3px solid var(--gold); padding-left: 12px; margin-bottom: 20px; }

  .bukken-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .bukken-card { display: block; text-decoration: none; border-radius: 10px; padding: 24px; transition: transform 0.2s, box-shadow 0.2s; }
  .bukken-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
  .card-emoji { font-size: 32px; line-height: 1; margin-bottom: 8px; }
  .card-type { font-size: 11px; letter-spacing: 2px; opacity: 0.75; margin-bottom: 4px; }
  .card-price { font-family: 'Noto Serif JP', serif; font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .card-addr { font-size: 13px; margin-bottom: 4px; }
  .card-area { margin-top: 4px; }

  .cta-block { background: var(--dark); color: var(--white); border-radius: 12px; padding: 40px; text-align: center; margin-bottom: 40px; }
  .cta-block h2 { font-family: 'Noto Serif JP', serif; font-size: 22px; font-weight: 600; margin-bottom: 12px; }
  .cta-block p { color: rgba(255,255,255,0.75); font-size: 14px; margin-bottom: 24px; line-height: 1.7; }
  .cta-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn-primary { background: var(--gold); color: var(--white); padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 14px; font-weight: 500; }
  .btn-secondary { border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.8); padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 14px; }

  footer { background: var(--dark); color: rgba(255,255,255,0.7); padding: 48px 24px 24px; }
  .footer-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding-bottom: 32px; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .footer-inner h3 { font-family: 'Noto Serif JP', serif; font-size: 14px; color: var(--white); margin-bottom: 12px; }
  .footer-inner p { font-size: 12px; line-height: 1.8; }
  .footer-inner ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .footer-inner ul li a { color: rgba(255,255,255,0.6); text-decoration: none; font-size: 12px; }
  .footer-inner ul li a:hover { color: var(--gold-light); }
  .footer-bottom { text-align: center; font-size: 11px; color: rgba(255,255,255,0.3); padding-top: 20px; max-width: 1200px; margin: 0 auto; }

  @media (max-width: 900px) { .bukken-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .bukken-grid { grid-template-columns: 1fr; } nav { display: none; } .footer-inner { grid-template-columns: 1fr; } }
</style>
</head>
<body>

${renderHeader()}

<nav class="breadcrumb" aria-label="パンくずリスト">
  <a href="/">トップ</a>
  <span class="breadcrumb-sep">›</span>
  <span>販売中の物件一覧</span>
</nav>

<div class="page-hero">
  <h1>販売中の物件一覧</h1>
  <p>茨城県内の土地・中古一戸建て・売店舗 計${total}件。市町別に掲載しています。</p>
</div>

<main class="bukken-index-main">

${groupHtml}

<div class="cta-block">
  <h2>物件についてのお問い合わせ</h2>
  <p>掲載物件の詳細確認・現地案内のご予約はお気軽に。<br>TEL：0299-35-2123（10:00〜18:00 / 日曜・祝日休み）</p>
  <div class="cta-buttons">
    <a href="tel:0299-35-2123" class="btn-primary">電話で問い合わせ 0299-35-2123</a>
    <a href="/#contact" class="btn-secondary">フォームで問い合わせ</a>
  </div>
</div>

</main>

${renderFooter()}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "トップ", "item": "https://meijifudosan.com/"},
    {"@type": "ListItem", "position": 2, "name": "販売中の物件一覧", "item": "https://meijifudosan.com/bukken/"}
  ]
}
</script>

</body>
</html>`;
}

// sitemap.xmlに bukken/ URLを追記（既存エントリは触らない）
function updateSitemap(athomeIds) {
  let xml = fs.readFileSync(SITEMAP, 'utf-8');

  const newUrls = [];
  // bukken/index.html
  const indexUrl = `https://meijifudosan.com/bukken/`;
  if (!xml.includes(indexUrl)) {
    newUrls.push(`  <url>
    <loc>${indexUrl}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  }

  // 個別ページ
  for (const id of athomeIds) {
    const loc = `https://meijifudosan.com/bukken/${id}/`;
    if (!xml.includes(loc)) {
      newUrls.push(`  <url>
    <loc>${loc}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
    }
  }

  if (newUrls.length > 0) {
    xml = xml.replace('</urlset>', newUrls.join('\n') + '\n</urlset>');
    fs.writeFileSync(SITEMAP, xml, 'utf-8');
    console.log(`sitemap.xml: added ${newUrls.length} URLs`);
  } else {
    console.log('sitemap.xml: no new URLs to add');
  }
}

// エリアページへの差し込み（冪等）
// マーカー: <!-- BUKKEN:START --> ... <!-- BUKKEN:END -->
function injectAreaPage(htmlPath, cityItems) {
  if (!fs.existsSync(htmlPath)) {
    console.log(`SKIP (not found): ${htmlPath}`);
    return;
  }
  if (cityItems.length === 0) {
    console.log(`SKIP (no items): ${htmlPath}`);
    return;
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');

  const cards = cityItems.map(({ item, athome_id }) => {
    const spec = item.spec || {};
    const typeInfo = getTypeInfo(spec);
    const price = spec['価格'] || '';
    const shortAddr = getShortAddress(spec);
    return `  <div class="related-card" style="background:${typeInfo.bg};border:none;">
    <a href="/bukken/${athome_id}/" style="color:${typeInfo.accent};">${typeInfo.emoji} ${esc(shortAddr)} ${esc(typeInfo.label)}</a>
    <div class="desc" style="color:rgba(255,255,255,0.7);">${esc(price)}</div>
  </div>`;
  }).join('\n');

  const inject = `<!-- BUKKEN:START -->
<section>
<h2>販売中の物件</h2>
<div class="related-grid">
${cards}
  <div class="related-card">
    <a href="/bukken/">物件一覧をすべて見る</a>
    <div class="desc">掲載中の全物件を確認できます。</div>
  </div>
</div>
</section>
<!-- BUKKEN:END -->`;

  const startMarker = '<!-- BUKKEN:START -->';
  const endMarker = '<!-- BUKKEN:END -->';

  if (html.includes(startMarker) && html.includes(endMarker)) {
    // 既存マーカー内を置換
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker) + endMarker.length;
    html = html.slice(0, start) + inject + html.slice(end);
  } else {
    // cta-blockの直前に挿入
    const insertBefore = '<div class="cta-block">';
    if (html.includes(insertBefore)) {
      html = html.replace(insertBefore, inject + '\n\n' + insertBefore);
    } else {
      // mainの閉じタグの直前
      html = html.replace('</main>', inject + '\n</main>');
    }
  }

  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`Injected ${cityItems.length} items into ${htmlPath}`);
}

// メイン処理
function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  const items = [];
  for (const item of data) {
    const parsed = parseUrl(item.url);
    if (!parsed) {
      console.log(`SKIP (cannot parse URL): ${item.url}`);
      continue;
    }
    items.push({ item, athome_id: parsed.athome_id });
  }

  console.log(`Processing ${items.length} items...`);

  // bukken/ ディレクトリ作成
  const bukkenDir = path.join(ROOT, 'bukken');
  if (!fs.existsSync(bukkenDir)) fs.mkdirSync(bukkenDir, { recursive: true });

  // 個別ページ生成
  for (const { item, athome_id } of items) {
    const dir = path.join(bukkenDir, athome_id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const html = buildDetailPage(item, athome_id);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
    console.log(`  Created: bukken/${athome_id}/index.html`);
  }

  // 一覧ページ生成
  const indexHtml = buildIndexPage(items);
  fs.writeFileSync(path.join(bukkenDir, 'index.html'), indexHtml, 'utf-8');
  console.log(`  Created: bukken/index.html`);

  // sitemap更新
  updateSitemap(items.map(i => i.athome_id));

  // エリアページへの差し込み
  // 市町とエリアページのマッピング
  const areaPages = {
    '石岡市': path.join(ROOT, 'ishioka', 'index.html'),
    '小美玉市': path.join(ROOT, 'omitama', 'index.html'),
    'かすみがうら市': path.join(ROOT, 'kasumigaura', 'index.html'),
    '土浦市': path.join(ROOT, 'tsuchiura', 'index.html'),
    '笠間市': path.join(ROOT, 'kasama', 'index.html'),
  };

  // 市町別グループ
  const cityGroups = {};
  for (const city of Object.keys(areaPages)) cityGroups[city] = [];

  for (const { item, athome_id } of items) {
    const spec = item.spec || {};
    const addrFull = spec['所在地'] || '';
    for (const city of Object.keys(areaPages)) {
      if (addrFull.includes(city)) {
        cityGroups[city].push({ item, athome_id });
        break;
      }
    }
  }

  for (const [city, htmlPath] of Object.entries(areaPages)) {
    injectAreaPage(htmlPath, cityGroups[city]);
  }

  // トップページの物件セクション末尾にリンク追加（最小変更・冪等）
  const topIndexPath = path.join(ROOT, 'index.html');
  let topHtml = fs.readFileSync(topIndexPath, 'utf-8');
  const bukkenLink = '<a href="/bukken/" class="btn-outline" style="border-color:rgba(255,255,255,0.2);color:var(--gold-light);font-size:13px;padding:12px 28px;">掲載物件をすべて見る → /bukken/</a>';
  if (!topHtml.includes('/bukken/')) {
    // properties-more の閉じdivの前に挿入
    topHtml = topHtml.replace(
      '<a href="#contact" class="btn-outline" style="border-color:rgba(255,255,255,0.2);color:var(--muted);font-size:13px;padding:12px 28px;">物件について直接相談する</a>',
      bukkenLink + '\n      <a href="#contact" class="btn-outline" style="border-color:rgba(255,255,255,0.2);color:var(--muted);font-size:13px;padding:12px 28px;">物件について直接相談する</a>'
    );
    fs.writeFileSync(topIndexPath, topHtml, 'utf-8');
    console.log('  Updated: index.html (added /bukken/ link)');
  } else {
    console.log('  index.html: /bukken/ link already present');
  }

  console.log('\nDone.');
}

main();
