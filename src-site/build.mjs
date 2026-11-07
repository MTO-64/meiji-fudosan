#!/usr/bin/env node
// content/(旧形式の正本)と scripts/athome-*.json を読み、URL・検索情報・本文を保ったまま新デザインを生成する。
// 出力: repo直下。OUT=<dir> で別の場所へ、PREVIEW=1 で計測タグなし。実行後に検索情報と本文量を機械照合し、差があれば止まる。
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTENT = join(ROOT, 'content');
const DIST = process.env.OUT ? resolve(process.env.OUT) : ROOT;
const PREVIEW = process.env.PREVIEW === '1';
const GA_ID = 'G-7YHR1QE05T';
const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
</script>`;
const show = (p) => readFileSync(join(CONTENT, p), 'utf8');
const WIDTHS = JSON.parse(readFileSync(join(HERE, 'img-widths.json'), 'utf8'));
const walk = (dir, base = '') => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEL = '0299-35-2123';
const TELA = `tel:${TEL}`;

const pages = walk(CONTENT).filter((p) => p.endsWith('index.html') && p !== 'index.html');
if (pages.length < 30) throw new Error(`ページ数が想定より少ない: ${pages.length}`);

const details = JSON.parse(readFileSync(join(ROOT, 'scripts/athome-details.json'), 'utf8')).filter((d) => d.ok !== false);
const listings = JSON.parse(readFileSync(join(ROOT, 'scripts/athome-listings.json'), 'utf8'));
const idOf = (d) => d.url.match(/\/(\d+)\/?$/)[1];
const norm = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/ｍ/g, 'm').replace(/ＪＲ/g, 'JR');

const items = details.map((d) => {
  const s = d.spec;
  const address = norm(s['所在地']).replace(/^茨城県/, '');
  const city = address.match(/^.+?市/)[0];
  const kindRaw = s['最適用途'] || s['物件種目'];
  const kind = /事業|工場/.test(kindRaw) ? '事業用地' : /店舗/.test(kindRaw) ? '店舗' : /一戸建|中古|住宅(?!用地)/.test(kindRaw) ? '中古住宅' : '土地';
  const area = norm(s['土地面積'] || s['敷地面積'] || '');
  const sqm = parseFloat(area.replace(/,/g, '')) || parseFloat(norm(s['建物面積'] || '').replace(/,/g, '')) || 0;
  return { id: idOf(d), address, city, town: address.slice(city.length), kind, kindRaw: norm(kindRaw), price: norm(s['価格']), man: parseFloat(norm(s['価格']).replace(/,/g, '')), area, building: norm(s['建物面積'] || ''), sqm, access: norm(s['交通'] || ''), deal: d['取引態様'] };
});
const confirmed = (() => { const [y, m, d] = listings.scraped_at.split('-').map(Number); return `${y}年${m}月${d}日`; })();
const rents = listings.listings.filter((l) => l.deal === 'rent');

function headOf(html) {
  const inner = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  const stripped = !PREVIEW ? inner : inner
    .replace(/<!--[^>]*(?:Google|GA4|gtag|tag)[^>]*-->\s*/gi, '')
    .replace(/<script[^>]*googletagmanager[^>]*><\/script>\s*/g, '')
    .replace(/<script>[^<]*gtag\([^<]*<\/script>\s*/g, '');
  return stripped
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<link[^>]*fonts\.g[^>]*>\s*/g, '')
    .replace(/<link[^>]*(landing|site)\.css[^>]*>\s*/g, '')
    .trim();
}
const jsonLd = (html) => (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join('\n');
const pick = (html, re) => (html.match(re) || [])[1] || '';
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const NAV = [['売りたい', '/baikyaku/'], ['探したい', '/bukken/'], ['地域', '/ibaraki/'], ['会社案内', '/company/']];
function shell({ head, body, ld = '', path = '/', dark = false, bodyClass = '', css = '', scripts = '' }) {
  const nav = NAV.map(([t, u]) => `<a href="${u}"${path.startsWith(u) ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
${head}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500&amp;family=BIZ+UDPGothic:wght@400;700&amp;display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500&amp;family=BIZ+UDPGothic:wght@400;700&amp;display=swap"></noscript>
${!PREVIEW && !head.includes('googletagmanager') ? GA : ''}
<link rel="stylesheet" href="/a/site.css">
<link rel="stylesheet" href="/a/inner.css">
<script>document.documentElement.classList.add('js');try{var r=matchMedia('(prefers-reduced-motion: reduce)').matches,d=document.documentElement,h=location.pathname==='/'&&!sessionStorage.getItem('meiji-seen'),t=sessionStorage.getItem('meiji-tr');if(!r&&(h||t)){d.classList.add('cover');d.dataset.cover=h?'intro':'tr'}sessionStorage.removeItem('meiji-tr');sessionStorage.setItem('meiji-seen','1')}catch(e){}</script>
${css ? `<link rel="stylesheet" href="/a/${css}">` : ''}
<meta name="theme-color" content="#17252c">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<div class="curtain" aria-hidden="true"><span>${[...'明治不動産'].map((c) => `<i>${c}</i>`).join('')}</span></div>
<a class="skip" href="#main">本文へ移動</a>
<header class="site-head">
  <a class="brand" href="/">株式会社明治不動産</a>
  <nav class="site-nav" aria-label="主なページ">${nav}</nav>
  <a class="head-tel" href="${TELA}">${TEL}</a>
  <a class="head-cta" href="/contact/">相談する</a>
  <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu">メニュー</button>
</header>
<div class="menu on-blue" id="menu" hidden>
  <button class="menu-close" type="button">閉じる</button>
  <a href="/baikyaku/">売りたい</a><a href="/bukken/">探したい</a><a href="/sozoku/">相続の相談</a><a href="/ibaraki/">地域</a><a href="/sora/">空から見る石岡</a><a href="/company/">会社案内</a><a href="/contact/">相談する</a>
  <div class="sub"><a href="${TELA}">電話 ${TEL}</a></div>
</div>
${body}
<footer class="site-foot">
  <p class="small">お電話がいちばん早いです。10:00〜17:00、日曜と祝日は休みです。</p>
  <a class="foot-tel" href="${TELA}">${TEL}</a>
  <div class="foot-grid">
    <address><p class="foot-name">株式会社明治不動産</p>〒315-0014 茨城県石岡市国府1丁目2-2<br>JR常磐線 石岡駅 西口から徒歩1分<br>FAX 0299-24-2102<br>茨城県知事免許(3) 第6811号</address>
    <ul><li><a href="/baikyaku/">売却と査定</a></li><li><a href="/sozoku/">相続の相談</a></li><li><a href="/ishioka/akiya/">空き家の相談</a></li><li><a href="/ishioka/before-selling/">売る前の確認</a></li></ul>
    <ul><li><a href="/bukken/">販売中の物件</a></li><li><a href="/ishioka/land/">石岡市の土地</a></li><li><a href="/ishioka/used-house/">石岡市の中古住宅</a></li><li><a href="/ibaraki/business-land/">茨城県の事業用地</a></li></ul>
    <ul><li><a href="/company/">会社案内</a></li><li><a href="/contact/">お問い合わせ</a></li><li><a href="/ibaraki/">対応エリア</a></li><li><a href="/sora/">空から見る石岡</a></li><li><a href="/policy/">サイトポリシー</a></li></ul>
  </div>
  <nav class="foot-area" aria-label="地域と種類から探す"><a href="/ishioka/">石岡市</a><a href="/ishioka/land/">石岡市の土地</a><a href="/ishioka/used-house/">石岡市の中古住宅</a><a href="/ishioka/akiya/">石岡市の空き家</a><a href="/ishioka/business-land/">石岡市の事業用地</a><a href="/omitama/">小美玉市</a><a href="/omitama/land/">小美玉市の土地</a><a href="/omitama/used-house/">小美玉市の中古住宅</a><a href="/kasumigaura/">かすみがうら市</a><a href="/tsuchiura/">土浦市</a><a href="/tsukuba/">つくば市</a><a href="/kasama/">笠間市</a><a href="/hokota/">鉾田市</a><a href="/ibaraki/">茨城県</a><a href="/ibaraki/land/">茨城県の土地</a><a href="/ibaraki/business-land/">茨城県の事業用地</a></nav>
</footer>
<div class="bar"><a href="${TELA}">電話する</a><a href="/contact/">相談を送る</a></div>
${ld}
<script src="/a/site.js" defer></script>
<script src="/a/gsap.min.js" defer></script>
<script src="/a/ScrollTrigger.min.js" defer></script>
<script src="/a/lenis.min.js" defer></script>
<script src="/a/motion.js" defer></script>
${scripts}
</body>
</html>
`;
  void dark;
  return html;
}

function write(rel, html) {
  const file = join(DIST, rel);
  mkdirSync(dirname(file), { recursive: true });
  // 見出しは語の切れ目でだけ折り返す(word-break:keep-all と組で効く)
  const breakText = (x) => x.replace(/([、。・])(?=.)/g, '$1<wbr>').replace(/(?<!鹿の)([ぁ-ん])(?=[一-龠ァ-ヶ])/g, (c, k, i, all) => (/[ごお]/.test(k) && !/[ぁ-ん]/.test(all[i - 1] || '')) ? c : `${c}<wbr>`);
  const phrase = (inner) => inner.replace(/(^|>)([^<]+)/g, (m, lead, x) => lead + breakText(x));
  // 実寸を記録した画像だけ srcset を付ける。全面の写真以外はスマホ全幅、PCは半分で足りる
  const withSet = html.replace(/<img([^>]*?) src="\/a\/s\/([a-z-]+)\.webp"([^>]*)>/g, (m, pre, n, post) => {
    const w = WIDTHS[n];
    if (!w || w <= 800) return m;
    const full = /fetchpriority/.test(pre + post) || /station-front/.test(n);
    return `<img${pre} src="/a/s/${n}.webp" srcset="/a/s/${n}-800.webp 800w, /a/s/${n}.webp ${w}w" sizes="${full ? '100vw' : '(max-width:999px) 100vw, 50vw'}"${post}>`;
  });
  const out = withSet.replace(/href="\/#contact"/g, 'href="/contact/"').replace(/<(h[12])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1>/g, (m, t, attrs, inner) => `<${t}${attrs}>${phrase(inner)}</${t}>`);
  writeFileSync(file, out);
}

function catalogRow(t) {
  return `<a class="cat-row" href="/bukken/${t.id}/" data-kind="${t.kind}" data-city="${t.city}" data-man="${t.man}">
    <span class="cat-addr"><span class="city">${t.city}</span><b>${esc(t.town)}</b></span>
    <span class="cat-kind">${esc(t.kindRaw)}</span>
    <span class="cat-price">${esc(t.price)}</span>
    <span class="cat-area">${esc(t.area || t.building)}${t.area && t.building ? `<br>建物 ${esc(t.building)}` : ''}</span>
    <span class="cat-acc">${esc(t.access)}</span>
  </a>`;
}
const catalogHead = '<div class="catalog-head" aria-hidden="true"><span>所在地</span><span>種別</span><span>価格</span><span>面積</span><span>交通</span></div>';

// 共通の相談の締め
const askBlock = (title, lead, query = '') => `<section class="ask-bar on-deep"><div><h2 class="t-l">${title}</h2><p class="mt1 measure">${lead}</p></div><div><a class="ask-go" href="/contact/${query}">フォームで相談する</a></div></section>`;

// ---- トップ -------------------------------------------------------------
function buildTop() {
  const old = show('index.html');
  const head = headOf(old).replace(/<!-- Preconnect[\s\S]*$/, '').trim();
  const picks = ['6964992076', '6989586224', '6981093188', '6981585775', '6983664674'].map((id) => items.find((t) => t.id === id)).filter(Boolean);
  // 目玉の物件が成約で消えても5件にする
  for (const t of items) if (picks.length < 5 && !picks.includes(t)) picks.push(t);
  const scene = (id, alt, extra = '') => `<img src="/a/s/${id}.webp" alt="${alt}" ${extra}>`;
  const worries = [
    ['/sozoku/', '相続した土地をどうすればいいかわからない', '名義や兄弟との話し合いが残っていても大丈夫です。', 'engawa', '縁側のある古い家'],
    ['/baikyaku/', 'いくらで売れるのか相場がわからない', '査定は無料です。売ると決めていなくても出します。', 'hands', '書類を確かめる手元'],
    ['/ishioka/akiya/', '古い建物や空き家を早く手放したい', '解体するか、そのまま売るかから一緒に考えます。', 'back', '路地の奥の古い家'],
    ['/baikyaku/', '近所に知られずに売却したい', '広告を出さない売り方もご相談ください。', 'town', '夕方の町並み'],
    ['/ishioka/before-selling/', '手続きが複雑で何から始めればいいかわからない', '順番を整理するところからお手伝いします。', 'keys', '机の上の鍵と紙'],
    ['/baikyaku/', 'なかなか買い手が見つからない', '価格と見せ方を見直します。', 'lot', '夕方の草地'],
  ];
  const lotCard = (t) => `<a class="lotc" href="/bukken/${t.id}/"><div><p class="ct">${t.city} ${esc(t.kindRaw)}</p><h3>${esc(t.town)}</h3></div><div><p class="pr">${esc(t.price)}</p><dl><div><dt>面積</dt><dd>${esc(t.area || t.building)}${t.area && t.building ? ` 建物 ${esc(t.building)}` : ''}</dd></div><div><dt>交通</dt><dd>${esc(t.access)}</dd></div></dl></div></a>`;
  const lotPic = (id, alt) => `<figure class="lotp">${scene(id, alt, 'loading="lazy"')}</figure>`;
  const flow = [['無料相談、査定', 'お電話、メール、ご来店でご相談ください。'], ['媒介契約', '売却条件を確認し、契約を締結します。'], ['販売活動', 'ポータルサイトへの掲載や、お問い合わせのお客様へのご紹介で買主を募集します。'], ['売買契約', '条件交渉、契約書作成、重要事項説明を行います。'], ['引渡し、完了', '決済と登記手続きを経て売却完了です。']];
  const areas = [['/ishioka/', '石岡市の不動産', '石岡市内の物件を総合的に。空き家、中古住宅、土地、事業用地まで。', 'a-ishioka'], ['/ishioka/used-house/', '石岡市の中古住宅、戸建て', '築浅から築古まで、リフォーム済み、現状渡しを幅広く。', 'a-ishioka'], ['/ishioka/land/', '石岡市の土地', '住宅用地、農地、分譲地、別荘地、事業用地。', 'a-ishioka'], ['/ishioka/akiya/', '石岡市の空き家', '空き家バンク掲載、未掲載を問わず売買、活用のご相談。', 'a-ishioka'], ['/ishioka/business-land/', '石岡市の事業用地', '常磐道IC、国道6号沿いの工場、倉庫、物流、店舗用地。', 'a-ishioka'], ['/omitama/', '小美玉市の不動産', '茨城空港エリア、小美玉市の物件総合。', 'a-omitama'], ['/omitama/used-house/', '小美玉市の中古住宅', '羽鳥駅徒歩圏、常磐道アクセスのよい中古戸建て。', 'a-omitama'], ['/omitama/land/', '小美玉市の土地', '住宅用地、農地、霞ヶ浦周辺の別荘地、事業用地。', 'a-omitama'], ['/ibaraki/', '茨城県の不動産', '石岡、小美玉、土浦を中心とする周辺7市町の総合窓口。広域エリア対応。', 'd1'], ['/ibaraki/land/', '茨城県の土地', '対応エリアの住宅用地、農地、別荘地、事業用地。', 'd1'], ['/ibaraki/business-land/', '茨城県の事業用地', '常磐道、圏央道、北関東道沿線の工場、倉庫、物流、店舗用地。', 'd1'], ['/baikyaku/', '売却、無料査定', '売却の流れと、ご相談の例。', 'a-d3'], ['/tsuchiura/', '土浦市', '土浦市の土地、中古住宅、売却。', 'a-tsuchiura'], ['/tsukuba/', 'つくば市', 'つくば市の土地、中古住宅、売却。', 'a-tsukuba'], ['/kasumigaura/', 'かすみがうら市', 'かすみがうら市の土地、中古住宅、売却。', 'a-kasumigaura'], ['/kasama/', '笠間市', '笠間市の土地、中古住宅、売却。', 'a-kasama'], ['/hokota/', '鉾田市', '鉾田市の土地、中古住宅、売却。', 'a-hokota']];
  // 大きく出すのは市と県の入口だけ。種別・他市のページは小さな文字リンクで残す(内部リンクは減らさない)
  const MAIN_AREAS = ['/ishioka/', '/omitama/', '/ibaraki/'];
  const faqs = [['売却査定や相談は無料ですか？', 'はい。売却査定、ご相談はすべて無料です。石岡市をはじめ周辺7市町の物件が対象で、無理な営業は行いません。まずはお電話(0299-35-2123)かお問い合わせフォームからご相談ください。'], ['対応エリアはどこまでですか？', '石岡市を中心に、小美玉市、かすみがうら市、土浦市、つくば市、笠間市、鉾田市の周辺7市町に対応しています。2000年設立で、各エリアの相場を踏まえてご相談に応じます。'], ['空き家や相続した不動産の相談もできますか？', 'はい。空き家、相続物件、実家じまいなどのご相談も承っています。「何から始めればよいかわからない」という段階からでも、売却、活用、解体まで含めて進め方をご相談します。'], ['来店せずに電話やメールだけでも相談できますか？', 'はい。お電話(0299-35-2123、10:00〜17:00、日曜祝日休み)、メール、お問い合わせフォームでのご相談が可能です。遠方の方や売却をご検討中の方も、まずはお問い合わせください。']];
  const body = `<main id="main">
<section class="s-open"><div class="pin">
  <div class="win">${scene('dawn', '朝焼けの田園と遠くの山', 'fetchpriority="high"')}</div>
  <h1>石岡市の不動産売買・賃貸なら 株式会社明治不動産</h1>
  <p class="say" aria-hidden="true"><b>石岡の</b><b>不動産</b></p>
  <p class="under">石岡駅から徒歩1分です。</p>
  <div class="entry"><a href="/baikyaku/">売りたい<small>相続した土地、空き家、査定のご相談</small></a><a href="/bukken/">探したい<small>土地、中古住宅、事業用地を販売中</small></a></div>
</div></section>
<section class="s-worry">
  <div class="pics" aria-hidden="true">${worries.map((w, i) => `<img class="${i ? '' : 'on'}" src="/a/s/${w[3]}.webp" alt="" loading="lazy">`).join('')}</div>
  <div class="rows"><h2>こんな時に、<br>ご相談ください。</h2><p class="measure" style="margin-bottom:32px">茨城県内の不動産売却は、石岡で長く営業してきた明治不動産にご相談ください。</p>
  <ul class="worries">${worries.map((w, i) => `<li><a class="${i ? '' : 'on'}" href="${w[0]}"><b>${w[1]}</b><span>${w[2]}</span></a></li>`).join('')}</ul></div>
</section>
<section class="s-side"><div class="side-track">
  <div class="side-title"><h2>販売中の物件</h2><p>全${items.length}件のうち5件。掲載情報の確認日 ${confirmed}</p></div>
  ${picks.slice(0, 5).map(lotCard).join('')}
  <a class="lote" href="/bukken/">販売中の物件を<wbr>すべて見る</a>
</div></section>
<section class="s-flow"><h2>売却の流れ</h2><p class="measure" style="margin-top:16px">ご相談から引渡しまで、担当者が一貫して対応します。</p>
  <div class="flow-grid"><ol class="track"><span class="fill" aria-hidden="true"></span>${flow.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('')}</ol><figure class="flow-pic" aria-hidden="true"><img src="/a/s/back.webp" alt="" loading="lazy"></figure></div>
</section>
<section class="s-area">
  <div class="area-bg" aria-hidden="true">${[...new Set(areas.map((x) => x[3]))].map((pic, i) => `<img alt="" data-pic="${pic}" data-src="/a/sora/${pic}.webp">`).join('')}</div>
  <div class="area-in"><h2>石岡市、茨城県の不動産</h2><p>エリア・物件種別ごとに専門ページをご用意しています。お探しのテーマからご覧ください。石岡市国府に本社を置く株式会社明治不動産は、石岡市を中心に、小美玉、かすみがうら、土浦、つくば、笠間、鉾田を含む周辺7市町の不動産売買、賃貸を取り扱っています。空き家、中古住宅、土地、事業用地のご相談に対応します。</p>
  <div class="area-rows">${areas.filter((x) => MAIN_AREAS.includes(x[0])).map(([u, t, d, pic]) => `<a href="${u}" data-pic="${pic}"><b>${t.replace('、', '、<wbr>')}</b><span>${d}</span></a>`).join('')}<a href="/sora/" data-pic="a-d3"><b>空から見る石岡</b><span>上空から店の真上まで降りる。同じ場所の60年。物件のある町。</span></a></div>
  <ul class="area-more">${areas.filter((x) => !MAIN_AREAS.includes(x[0])).map(([u, t]) => `<li><a href="${u}">${t}</a></li>`).join('')}</ul></div>
</section>
<section class="minor chapter"><div class="two"><div><h2 class="t-l">サービス内容</h2><p class="mt1 measure">土地・事業用地から住宅の売買・賃貸まで、不動産に関するあらゆるニーズにお応えします。</p></div><div>
<h3 class="t-s">売買仲介</h3><p class="mt1">マイホームの購入、売却のご相談に対応します。石岡、小美玉を中心に、土地、中古住宅の売買をお手伝いします。</p>
<h3 class="t-s mt2">土地、事業用地</h3><p class="mt1">住宅用地、売地から、工場、倉庫、物流、店舗用地まで。常磐道、圏央道アクセスを活かした事業用地を、相場を踏まえてご提案します。</p>
<h3 class="t-s mt2">賃貸仲介</h3><p class="mt1">一人暮らしからファミリーまで、ライフスタイルに合った賃貸物件をご紹介します。丁寧にヒアリングしてお部屋探しをお手伝いします。</p></div></div></section>
<section class="minor company-grid"><div class="stick"><figure class="co-pic"><img src="/a/s/station-plaza.webp" alt="石岡駅前のロータリーと町並み" loading="lazy"></figure><h2 class="t-l">2000年設立の<br>不動産会社です。</h2><p class="measure mt2">株式会社明治不動産は、茨城県に根ざした不動産会社として、地域のお客様に寄り添ったサービスを提供してきました。売買、賃貸を問わず、ご事情をうかがったうえで進め方をご相談します。物件探しから契約、引き渡しまで、担当者が一貫して対応します。</p><p class="mt1"><a href="/company/">会社概要の詳細を見る</a></p></div>
<dl class="facts">
<div><dt>会社名</dt><dd>株式会社明治不動産</dd></div><div><dt>所在地</dt><dd>〒315-0014 茨城県石岡市国府1丁目2-2</dd></div><div><dt>TEL</dt><dd>${TEL}</dd></div><div><dt>FAX</dt><dd>0299-24-2102</dd></div><div><dt>営業時間</dt><dd>10:00〜17:00(日曜、祝日休み)</dd></div><div><dt>設立</dt><dd>2000年</dd></div><div><dt>代表者</dt><dd>代表取締役 上野真仁</dd></div><div><dt>免許番号</dt><dd>茨城県知事免許(3) 第6811号</dd></div><div><dt>所属団体</dt><dd>(公社)茨城県宅地建物取引業協会会員<br>(公社)首都圏不動産公正取引協議会加盟<br>(公社)全国宅地建物取引業保証協会</dd></div>
<div><dt>電車で</dt><dd>JR常磐線「石岡駅」西口を出て直進、徒歩約1分。東京(上野)から約70分、水戸から約25分です。東京、品川、柏方面からはJR常磐線快速または特急をご利用ください。</dd></div>
<div><dt>車で</dt><dd>常磐自動車道「千代田石岡IC」から国道6号線を石岡市街方面へ約10分。「石岡小美玉スマートIC」(ETC専用)から県道7号線を石岡市街方面へ約15分。事務所前に駐車場があります。</dd></div>
</dl></section>
<section class="minor chapter on-pale faq-two"><h2 class="t-l">よくあるご質問</h2><div>${faqs.map(([q, a]) => `<div class="faq-item"><p class="faq-q">${q}</p><p class="faq-a">${a}</p></div>`).join('')}</div></section>
<section class="s-end">${scene('station-front', 'JR石岡駅とバスターミナル', 'loading="lazy"')}<div class="in"><h2>まず、話だけでも。</h2><p style="margin-top:12px"><a class="ask-go" href="/contact/">フォームで相談する</a></p></div></section>
</main>`;
  const scripts = '<script src="/a/top.js" defer></script>';
  write('index.html', shell({ head, body, ld: jsonLd(old), path: '/', bodyClass: 'home scene', css: 'top.css', scripts }));
}

// ---- 物件一覧: 目録 ------------------------------------------------------
function buildList() {
  const old = show('bukken/index.html');
  const head = headOf(old);
  const groups = ['すべて', '土地', '事業用地', '中古住宅', '店舗'];
  const cities = ['すべて', ...new Set(items.map((t) => t.city))];
  const prices = ['すべて', '500万円未満', '500〜1,000万円未満', '1,000万円以上'];
  const f = (k, label, vals) => `<div class="f-row" data-filter="${k}" role="group" aria-label="${label}"><span>${label}</span>${vals.map((v, i) => `<button type="button" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>`;
  const sorted = items.slice().sort((a, b) => (a.city === '石岡市' ? -1 : 0) - (b.city === '石岡市' ? -1 : 0) || a.man - b.man);
  const rent = rents.map((r) => `<a class="cat-row" href="${esc(r.athome_url || 'https://www.athome.co.jp/ahch/meijihudousan.html')}" rel="noopener"><span class="cat-addr"><span class="city">${esc(r.city || '')}</span><b>${esc(norm((r.address || '').replace(r.city || '', '')))}</b></span><span class="cat-kind">${esc(r.madori || '')}</span><span class="cat-price">${esc(r.price_text || '')}/月</span><span class="cat-area">${r.building_area_sqm ? `${r.building_area_sqm}m²` : ''}</span><span class="cat-acc">${esc(norm(r.access || ''))}</span></a>`).join('');
  const lead = strip(pick(old, /<div class="page-hero">[\s\S]*?<p>([\s\S]*?)<\/p>/));
  const crumb = `<nav class="crumb after" aria-label="パンくずリスト"><a href="/">トップ</a><span aria-hidden="true">/</span><span>物件一覧</span></nav>`;
  const body = `<main id="main"><header class="ph"><img src="/a/s/keys.webp" alt="" fetchpriority="high"><div class="ph-in"><h1>販売中の物件一覧</h1><p>${esc(lead)}</p></div></header>
${crumb}
<nav class="tabs" aria-label="売買と賃貸"><a href="#sale" aria-current="true">売買</a><a href="#rent">賃貸</a></nav>
<div class="filters">${f('kind', '種類', groups)}${f('city', '場所', cities)}${f('price', '価格', prices)}</div>
<section class="chapter" id="sale" style="padding-top:32px"><p class="t-m"><span id="count">${items.length}件</span></p><p class="note">掲載情報の確認日 ${confirmed}。最新の状況はお問い合わせください。</p>
<div class="mt2">${catalogHead}<div data-catalog>${sorted.map(catalogRow).join('')}</div><div class="catalog-empty" id="empty" hidden><p class="t-m">この条件の物件は今ありません。</p><p class="mt1">条件を変えるか、お電話ください。<a href="${TELA}">${TEL}</a></p></div></div></section>
<section class="chapter on-pale" id="rent"><div class="chapter-head split"><h2 class="t-l">賃貸の物件</h2><p class="note">詳細はアットホームの掲載ページでご覧いただけます。</p></div>${catalogHead}<div>${rent}</div></section>
${askBlock('物件についての<br>お問い合わせ', '掲載物件の詳細確認、現地案内のご予約はお気軽に。掲載していない条件でも、お探しの内容をうかがいます。', '?type=find')}
</main>`;
  write('bukken/index.html', shell({ head, body, ld: jsonLd(old), path: '/bukken/', bodyClass: 'scene' }));
}

// ---- 物件詳細: 図面 ------------------------------------------------------
function plot(t) {
  // 100m²のます目と同じ縮尺で面積を正方形にする。敷地の形ではない
  const side = Math.sqrt(t.sqm);
  const scale = Math.max(1, Math.ceil(side / 10));
  const unit = 100 / scale;
  const box = (side / (scale * 10)) * 300;
  const cells = [];
  for (let i = 0; i <= scale; i += 1) {
    const p = (i / scale) * 300;
    cells.push(`<path d="M${p} 0V300M0 ${p}H300" stroke="#b7cede" stroke-width="1"/>`);
  }
  const gridNote = unit === 100 ? '1ますは10m四方(100m²)' : `1ますは${scale * 10 / scale * scale}m四方`;
  return `<section class="plot"><h2 class="t-s">広さの目安</h2><svg viewBox="-1 -1 302 302" role="img" aria-label="面積${esc(t.area)}を正方形に換算した図">${cells.join('')}<rect x="0" y="${300 - box}" width="${box}" height="${box}" fill="#227ab6"/></svg><p class="note mt1">面積を正方形に換算した図です。実際の敷地の形や向きではありません。全体は${scale * 10}m四方、${gridNote.includes('10m') ? gridNote : `1ますは${scale * 10 / scale}m×${scale}…`}</p></section>`.replace(/全体は(\d+)m四方、[^<]*/, (m, n) => `全体は${n}m四方です。`);
}

function buildDetail(t) {
  const rel = `bukken/${t.id}/index.html`;
  const old = show(rel);
  const head = headOf(old);
  const rows = [...old.matchAll(/<tr><th>([^<]*)<\/th><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
  const skip = new Set(['価格']);
  const biko = pick(old, /<div class="biko-box">([\s\S]*?)<\/div>/);
  const chkNote = pick(old, /<p class="chk-note">([\s\S]*?)<\/p>/).replace(/[（(]公式ページの確認日[：:][^）)]*[）)]/g, '');
  const chk = [...old.matchAll(/<ul class="chk-list">([\s\S]*?)<\/ul>/g)].map((m) => m[1]).join('').replace(/(?:<br\s*\/?>\s*)?(?:<[a-z]+[^>]*>\s*)?出典[：:]\s*(?:<a[\s\S]*?<\/a>)?(?:\s*<\/(?:span|small)>)?/g, '');
  const h1 = pick(old, /<h1[^>]*>([\s\S]*?)<\/h1>/);
  const hasPhoto = t.id === '6964992076';
  const notice = pick(old, /<div class="notice-box">([\s\S]*?)<\/div>/).trim();
  const crumbName = t.address;
  const ctaText = strip(pick(old, /<div class="cta-block">[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/));
  const crumb = `<nav class="crumb after" aria-label="パンくずリスト"><a href="/">トップ</a><span aria-hidden="true">/</span><a href="/bukken/">物件一覧</a><span aria-hidden="true">/</span><span>${esc(crumbName)}</span></nav>`;
  const body = `<main id="main">
<header class="sheet-head"><div class="sh-t"><p class="kind">${esc(t.kindRaw)} / ${esc(t.deal || '')}</p><h1>${h1 || esc(t.address)}</h1></div>
<dl class="keyfacts"><div style="grid-column:1/3"><dt>価格</dt><dd>${esc(t.price)}</dd></div>${t.area ? `<div${t.building ? '' : ' style="grid-column:1/3"'}><dt>土地面積</dt><dd class="kf-s">${esc(t.area)}</dd></div>` : ''}${t.building ? `<div><dt>建物面積</dt><dd class="kf-s">${esc(t.building)}</dd></div>` : ''}</dl></header>
${crumb}
<div class="sheet-body"><div>
<table class="spec"><caption>物件概要</caption><tbody>${rows.filter(([k]) => !skip.has(k)).map(([k, v]) => `<tr><th scope="row">${k}</th><td>${norm(v)}</td></tr>`).join('')}<tr><th scope="row">価格</th><td>${esc(t.price)}</td></tr></tbody></table>
${biko ? `<section class="mt3"><h2 class="t-m">備考</h2><p class="mt1 measure">${norm(biko)}</p></section>` : ''}
${chk ? `<section class="mt3"><h2 class="t-m">この物件を検討するときの確認ポイント</h2><p class="note mt1 measure">${chkNote}</p><ul class="check mt1">${norm(chk)}</ul></section>` : ''}
</div><aside class="sheet-side">
${hasPhoto ? `<figure class="bleed" style="margin-bottom:24px"><img loading="lazy" src="/a/yamazaki.webp" width="640" height="480" alt="${esc(t.address)}の物件写真"></figure>` : ''}
${t.sqm ? plot(t) : ''}
<p class="dated mt2">${esc(notice)}</p>
<p class="mt2"><a class="t-s" href="/contact/?type=find&amp;item=${encodeURIComponent(t.address)}">この物件について相談する</a></p>
<p class="mt1"><a class="t-s" href="${TELA}">${TEL}</a></p></aside></div>
${askBlock('この物件について<br>お問い合わせ', esc(ctaText || '現地のご案内や資料のご請求も承ります。'), `?type=find&amp;item=${encodeURIComponent(t.address)}`)}
</main>`;
  write(rel, shell({ head, body, ld: jsonLd(old), path: '/bukken/', bodyClass: 'scene' }));
}

// ---- 下層の読み物 --------------------------------------------------------
const PHOTOS = { ishioka: ['torii', 'station', 'road'], sozoku: ['road'], baikyaku: ['field'], company: ['station'] };
function buildDoc(rel) {
  const old = show(rel);
  const head = headOf(old);
  const path = `/${rel.replace(/index\.html$/, '')}`;
  const h1 = pick(old, /<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<span class="accent">|<\/span>/g, '');
  const sub = pick(old, /<p class="subtitle">([\s\S]*?)<\/p>/) || pick(old, /class="subtitle"[^>]*>([\s\S]*?)<\//);
  let main = pick(old, /<main[^>]*>([\s\S]*?)<\/main>/);
  const crumb = [...pick(old, /(<nav class="breadcrumb"[\s\S]*?<\/nav>)/).matchAll(/<a href="([^"]+)">([^<]+)<\/a>|<span(?: aria-current="[^"]*")?>([^<]+)<\/span>/g)];
  const crumbs = crumb.map((m) => (m[1] ? `<a href="${m[1]}">${m[2]}</a>` : `<span>${m[3]}</span>`)).join('<span aria-hidden="true">/</span>');
  // 相談ブロックは共通部品へ置き換える。文言は引き継ぐ
  const ctaM = main.match(/<div class="cta-block">([\s\S]*?)<\/div>\s*<\/div>|<div class="cta-block">([\s\S]*?)<\/div>/);
  const ctaH = strip(pick(main, /<div class="cta-block">[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/));
  const ctaP = strip(pick(main, /<div class="cta-block">[\s\S]*?<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/));
  main = main.replace(/<section[^>]*>\s*<div class="cta-block"[^>]*>[\s\S]*?<\/section>/g, '').replace(/<div class="cta-block"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, '');
  void ctaM;
  main = main.replace(/<p[^>]*>\s*出典[：:][\s\S]*?<\/p>/g, '').replace(/[（(]確認日[：:][^）)]*[）)]/g, '');
  main = main.replace(/ style="[^"]*"/g, '').replace(/→/g, '').replace(/<table/g, '<div class="scroll-x"><table').replace(/<\/table>/g, '</table></div>');
  // 章に番号の無いIDを振って目次を作る
  let n = 0;
  const toc = [];
  main = main.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (m, attrs, text) => { n += 1; toc.push([`s${n}`, strip(text)]); return `<h2 id="s${n}"${attrs}>${text}</h2>`; });
  const key = rel.split('/')[0];
  const HERO = [[/business-land/, 'factory'], [/used-house/, 'engawa'], [/land/, 'lot'], [/akiya/, 'back'], [/before-selling/, 'hands'], [/^baikyaku/, 'hands'], [/^sozoku/, 'engawa'], [/^company/, 'aerial-ishioka'], [/^ishioka/, 'dawn'], [/^omitama/, 'road'], [/^kasumigaura/, 'lake'], [/^tsuchiura/, 'lake'], [/^tsukuba/, 'road'], [/^kasama/, 'grain'], [/^hokota/, 'town'], [/^ibaraki/, 'dawn']];
  const hero = (HERO.find(([re]) => re.test(rel)) || [0, 'town'])[1];
  const brkPool = ['grain', 'road', 'town', 'keys', 'lake', 'hands', 'back'].filter((x) => x !== hero);
  let h2i = 0;
  main = main.replace(/<h2 id="s\d+"/g, (m) => { h2i += 1; if (h2i === 1 || h2i % 2 !== 0) return m; const pic = brkPool[(h2i / 2 - 1 + rel.length) % brkPool.length]; return `<figure class="brk" aria-hidden="true"><img src="/a/s/${pic}.webp" alt="" loading="lazy"></figure>${m}`; });
  const photoName = rel === 'ishioka/index.html' ? 'torii' : rel === 'ishioka/akiya/index.html' ? 'road' : rel === 'ishioka/before-selling/index.html' ? 'station' : rel === 'baikyaku/index.html' ? 'field' : rel === 'sozoku/index.html' ? 'lake' : rel === 'company/index.html' ? 'station' : null;
  void key; void PHOTOS;
  const cityName = { ishioka: '石岡市', omitama: '小美玉市', kasumigaura: 'かすみがうら市', tsuchiura: '土浦市', kasama: '笠間市' }[rel.split('/')[0]];
  const local = cityName ? items.filter((t) => t.city === cityName) : [];
  const localBlock = local.length ? `<section class="local"><div class="chapter-head split"><h2 class="t-l">${cityName}で販売中の物件</h2><p class="note">掲載情報の確認日 ${confirmed}</p></div>${catalogHead}<div>${local.slice(0, 6).map(catalogRow).join('')}</div></section>` : '';
  const special = rel === 'baikyaku/index.html'
    ? `<section class="chapter on-blue"><h2 class="t-l">相談から、引渡しまで。</h2><ol class="process h mt3"><li><b>無料相談、査定</b><span>お電話、メール、ご来店で。</span></li><li><b>媒介契約</b><span>売却の条件を確認して契約します。</span></li><li><b>販売活動</b><span>掲載とご紹介で買主を募ります。</span></li><li><b>売買契約</b><span>交渉、契約書、重要事項説明。</span></li><li><b>引渡し、完了</b><span>決済と登記で完了です。</span></li></ol></section>`
    : rel === 'sozoku/index.html'
      ? `<section class="chapter on-pale"><h2 class="t-l">いま、どの段階ですか。</h2><nav class="branches h mt2" aria-label="状況別の入口"><a href="/contact/?type=inherit"><b>これから相続する</b><span>名義や手続きの前でも、ご相談いただけます。</span></a><a href="/contact/?type=inherit"><b>相続した</b><span>土地や家をどうするかの段階から。</span></a><a href="/ishioka/akiya/"><b>空き家になった</b><span>空き家の売却と活用のご相談へ。</span></a></nav></section>`
      : '';
  void photoName;
  const body = `<main id="main">
<header class="ph"><img src="/a/s/${hero}.webp" alt="" fetchpriority="high"><div class="ph-in"><h1>${h1}</h1>${sub ? `<p>${sub}</p>` : ''}</div></header>
<nav class="crumb after" aria-label="パンくずリスト">${crumbs}</nav>
${special}
<div class="doc">${toc.length > 1 ? `<nav class="toc" aria-label="このページの目次"><p>目次</p>${toc.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>` : '<span></span>'}<div class="prose">${main}</div></div>
${localBlock}
${askBlock(esc(ctaH || 'まずはご相談ください。'), esc(ctaP || '査定と相談は無料です。'), rel.startsWith('sozoku') ? '?type=inherit' : rel.startsWith('baikyaku') ? '?type=sell' : '')}
</main>`;
  write(rel, shell({ head, body, ld: jsonLd(old), path, bodyClass: 'scene' }));
}

// 公開キーと件名は本番のフォームと同じものを正本から引き継ぐ
function formHidden() {
  const top = show('index.html');
  const val = (name) => (top.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1];
  const key = val('access_key');
  if (!key) throw new Error('正本のフォームに公開キーが無い');
  return `<input type="hidden" name="access_key" value="${esc(key)}"><input type="hidden" name="subject" value="${esc(val('subject') || 'お問い合わせ')}"><input type="hidden" name="from_name" value="${esc(val('from_name') || '明治不動産サイト')}"><input type="checkbox" name="botcheck" class="bot" tabindex="-1" autocomplete="off" aria-hidden="true">`;
}

// ---- 問い合わせ・ポリシー・404 ------------------------------------------
function buildExtras() {
  const contact = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>お問い合わせ｜株式会社明治不動産</title><meta name="description" content="石岡市の不動産のご相談はこちらから。売却、相続、物件探しの種類ごとにご相談いただけます。査定と相談は無料です。"><link rel="canonical" href="https://meijifudosan.com/contact/">`;
  write('contact/index.html', shell({ head: contact, path: '/contact/', bodyClass: 'scene', body: `<main id="main"><header class="ph"><img src="/a/s/keys.webp" alt="" fetchpriority="high"><div class="ph-in"><h1>どの段階でも、<br>相談できます。</h1></div></header><nav class="crumb after" aria-label="パンくずリスト"><a href="/">トップ</a><span aria-hidden="true">/</span><span>お問い合わせ</span></nav>
<div class="contact-grid"><div class="stick"><p class="measure mt2">売ると決めていなくてもかまいません。査定と相談は無料です。秘密は厳守します。</p><a class="t-m mt2" style="display:block" href="${TELA}">${TEL}</a><p class="small">10:00〜17:00、日曜と祝日は休みです。翌営業日までにお返事します。</p></div>
<form id="consult" method="post" action="https://api.web3forms.com/submit" novalidate>${formHidden()}<fieldset style="border:0;padding:0"><legend class="t-s" style="margin-bottom:8px">相談の種類</legend><div class="kinds">
<label><input type="radio" name="type" value="sell">売りたい</label><label><input type="radio" name="type" value="inherit">相続、空き家</label><label><input type="radio" name="type" value="find">物件を探したい</label><label><input type="radio" name="type" value="other">その他</label></div></fieldset>
<label class="field" data-when="sell inherit" hidden><span>不動産のある場所<small>市町名だけでもかまいません</small></span><input name="place" autocomplete="off"></label>
<label class="field" data-when="find" hidden><span>気になる物件<small>あれば</small></span><input name="item" autocomplete="off"></label>
<label class="field"><span>お名前</span><input name="name" required autocomplete="name"></label>
<label class="field"><span>お電話番号</span><input name="tel" type="tel" autocomplete="tel"></label>
<label class="field"><span>メールアドレス</span><input name="email" type="email" autocomplete="email"></label>
<label class="field"><span>ご相談の内容<small>書ける範囲で</small></span><textarea name="message"></textarea></label>
<button class="submit" type="submit">この内容で相談する</button><p class="status" id="status" role="status" tabindex="-1"></p>
<p class="note">送信いただいた個人情報は、お問い合わせへの回答にのみ使用し、第三者への提供は行いません。</p></form></div></main>` }));
  const pol = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>サイトポリシー｜株式会社明治不動産</title><meta name="robots" content="noindex, follow"><link rel="canonical" href="https://meijifudosan.com/policy/">`;
  write('policy/index.html', shell({ head: pol, path: '/policy/', body: `<main id="main"><header class="page-title"><h1>サイトポリシー</h1></header><div class="doc"><span></span><div class="prose"><section><h2>個人情報の取り扱い</h2><p>お問い合わせフォームから送信いただいた個人情報は、お問い合わせへの回答にのみ使用し、第三者への提供は行いません。送信にはフォーム送信サービス Web3Forms を利用しています。</p></section><section><h2>アクセス解析</h2><p>このサイトは利用状況を把握するために Google アナリティクスを使用しています。Cookie を用いて個人を特定しない形で情報を収集します。</p></section><section><h2>空中写真について</h2><p>「空から見る石岡」の空中写真は、国土地理院の地理院タイルを加工して作成しました。</p></section></div></div></main>` }));
  const nf = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ページが見つかりません｜株式会社明治不動産</title><meta name="robots" content="noindex">`;
  write('404.html', shell({ head: nf, body: `<main id="main" class="lost"><h1 class="t-l">このページは<br>見つかりません。</h1><p class="measure">住所が変わったか、掲載が終わった可能性があります。掲載が終わった物件でも、似た条件をご紹介できることがあります。</p><p class="t-s"><a href="/bukken/">販売中の物件を見る</a></p><p class="t-s"><a href="/baikyaku/">売却の相談をする</a></p><p class="t-s"><a href="${TELA}">${TEL}</a></p></main>` }));
}

// ---- 空から見る: 国土地理院の実写 ------------------------------------------
function buildSora() {
  const AERIAL = join(ROOT, 'a', 'sora');
  const cfg = readFileSync(join(HERE, 'descend.json'), 'utf8');
  const towns = items.filter((t) => existsSync(join(AERIAL, `town${t.id}.webp`)));
  if (towns.length !== items.length) throw new Error(`空中写真の無い物件: ${items.length - towns.length}件`);
  const head = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>空から見る石岡｜株式会社明治不動産</title><meta name="description" content="筑波山と霞ヶ浦のあいだの石岡市を、空中写真で見るページです。石岡駅周辺の60年の変化と、販売中の物件がある町をご覧いただけます。"><link rel="canonical" href="https://meijifudosan.com/sora/">`;
  const body = `<main id="main">
<section class="dive" id="dive"><div class="stage" id="stage">
  <canvas id="c" aria-hidden="true"></canvas><div id="marks" aria-hidden="true"></div><div class="shop-mark" id="shop-mark" aria-hidden="true"></div>
  <div class="line on"><small>空から見る石岡</small><h1>筑波山と<wbr>霞ヶ浦のあいだ。</h1></div>
  <div class="line"><small>幅およそ12km</small>ここが、<wbr>石岡市です。</div>
  <div class="line"><small>幅およそ3km</small>常磐線の石岡駅。</div>
  <div class="line"><small>JR石岡駅 西口から</small>歩いて1分に、<wbr>店があります。</div>
  <div class="scale" aria-hidden="true"><span id="sv"></span><i id="sb"></i></div>
</div></section>
<section class="time" id="time"><div class="stage" id="time-stage">
  <img class="lay" src="/a/sora/tnow.webp" alt="現在の石岡駅周辺の空中写真" loading="lazy">
  <img class="lay" id="l2" src="/a/sora/t1975.webp" alt="1974年から1978年の石岡駅周辺の空中写真" loading="lazy">
  <img class="lay" id="l1" src="/a/sora/t1960.webp" alt="1961年から1969年の石岡駅周辺の空中写真" loading="lazy">
  <div class="edge" id="edge"></div><div class="yr" id="yrL" aria-hidden="true">1960年代</div><div class="yr next" id="yrR" aria-hidden="true">1970年代</div>
  <button class="handle" id="handle" type="button" aria-label="年代の境界を動かす">動かす</button>
  <div class="time-head"><h2>同じ場所を、<br>60年ぶん見てみる。</h2><p>JR石岡駅の周辺です。</p></div>
</div></section>
<section class="s-wall">
  <div class="wall-bg" aria-hidden="true">${towns.map((t, i) => `<img alt="" ${i ? 'data-src' : 'src'}="/a/sora/town${t.id}.webp">`).join('')}</div>
  <div class="wall"><h2>物件のある町</h2><p>販売中の${towns.length}件です。町名を選ぶと物件の詳細が開きます。背景は町の代表地点の空中写真で、物件の位置ではありません。</p>
  ${towns.map((t) => `<a class="nm" href="/bukken/${t.id}/"><span>${esc(t.town)}</span><small>${t.city} ${esc(t.kindRaw)} ${esc(t.price)}</small></a>`).join('')}</div>
</section>
<section class="s-sora-end"><h2>土地の相談は、<br>場所の話から<br>始まります。</h2><p>相続した土地も、空き家も、まず場所を教えてください。査定と相談は無料です。</p><a class="ask-go" href="/contact/">フォームで相談する</a></section>
</main>
<script type="application/json" id="descend">${cfg}</script>`;
  write('sora/index.html', shell({ head, body, path: '/sora/', bodyClass: 'scene', css: 'sora.css', scripts: '<script src="/a/sora.js" defer></script>' }));
}

// ---- 照合 ----------------------------------------------------------------
function verify() {
  const facts = (html) => {
    const one = (re) => (html.match(re) || [])[1]?.trim() || '';
    const body = one(/<body[^>]*>([\s\S]*)<\/body>/);
    return {
      title: one(/<title>([\s\S]*?)<\/title>/), description: one(/<meta name="description" content="([^"]*)"/), canonical: one(/<link rel="canonical" href="([^"]*)"/), robots: one(/<meta name="robots" content="([^"]*)"/),
      h1: strip(one(/<h1[^>]*>([\s\S]*?)<\/h1>/)).replace(/\s/g, ''), jsonLd: (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join(''),
      text: strip(body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')).replace(/\s/g, '').length,
      links: new Set([...body.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1])),
    };
  };
  const problems = [];
  for (const rel of ['index.html', ...pages]) {
    const file = join(DIST, rel);
    if (!existsSync(file)) { problems.push(`${rel}: 作られていない`); continue; }
    const a = facts(show(rel)); const b = facts(readFileSync(file, 'utf8'));
    for (const k of ['title', 'description', 'canonical', 'robots', 'jsonLd']) if (a[k] !== b[k]) problems.push(`${rel}: ${k} が変わった`);
    if (a.h1 && a.h1 !== b.h1) problems.push(`${rel}: h1「${a.h1.slice(0, 26)}」→「${b.h1.slice(0, 26)}」`);
    // ownerの指示で意図して削った頁だけ下限を下げる(2026-11-08 トップの地域行の説明文を削除「長いから」)
    const MIN_RATIO = { 'index.html': 0.78 };
    if (b.text < a.text * (MIN_RATIO[rel] ?? 0.85)) problems.push(`${rel}: 本文 ${a.text}→${b.text}字`);
    const lost = [...a.links].filter((l) => !b.links.has(l) && !/\.(css|js|png|jpg|xml)$/.test(l));
    if (lost.length) problems.push(`${rel}: 内部リンク消失 ${lost.slice(0, 5).join(' ')}`);
  }
  // 全内部リンクが実在するか
  const dead = new Set();
  for (const rel of ['index.html', ...pages, 'contact/index.html', 'policy/index.html', '404.html', 'sora/index.html']) {
    const html = readFileSync(join(DIST, rel), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
      const p = m[1]; const f = p.endsWith('/') ? join(DIST, p, 'index.html') : join(DIST, p);
      if (!existsSync(f)) dead.add(`${rel} → ${p}`);
    }
  }
  // 計測タグ: 本番は全ページちょうど1回、試作は0回
  for (const rel of ['index.html', ...pages, 'contact/index.html', 'policy/index.html', '404.html', 'sora/index.html']) {
    const html = readFileSync(join(DIST, rel), 'utf8');
    const loader = (html.match(/googletagmanager\.com\/gtag\/js\?id=G-7YHR1QE05T/g) || []).length;
    const config = (html.match(/gtag\('config', 'G-7YHR1QE05T'\)/g) || []).length;
    const want = PREVIEW ? 0 : 1;
    if (loader !== want || config !== want || (PREVIEW && /gtag\(/.test(html))) problems.push(`${rel}: 計測タグ 読込${loader}回 設定${config}回`);
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) for (const part of m[1].split(',')) { const u = part.trim().split(' ')[0]; if (!existsSync(join(DIST, u))) dead.add(`${rel} → ${u}`); }
  }
  console.log(`照合 ${pages.length + 1}ページ / 問題 ${problems.length}件 / 切れた内部リンク ${dead.size}件`);
  problems.slice(0, 40).forEach((p) => console.log(' ', p));
  [...dead].slice(0, 30).forEach((p) => console.log('  切れ', p));
  return problems.length + dead.size;
}

// 成約で消えた物件が残らないよう一覧を作り直す。写真は a/s と a/sora に置いたまま
rmSync(join(DIST, 'bukken'), { recursive: true, force: true });
mkdirSync(join(DIST, 'a'), { recursive: true });
if (DIST !== ROOT) cpSync(join(ROOT, 'a'), join(DIST, 'a'), { recursive: true });
for (const f of ['site.css', 'site.js', 'top.css', 'top.js', 'inner.css', 'motion.js', 'sora.css', 'sora.js']) copyFileSync(join(HERE, f), join(DIST, 'a', f));
// サイトマップ: 正本へ新しいURLだけ足す
writeFileSync(join(DIST, 'sitemap.xml'), ['contact', 'sora'].reduce((xml, p) => (xml.includes(`/${p}/<`) ? xml : xml.replace('</urlset>', `  <url><loc>https://meijifudosan.com/${p}/</loc></url>\n</urlset>`)), show('sitemap.xml')));
buildTop();
buildList();
for (const t of items) buildDetail(t);
for (const rel of pages) if (!rel.startsWith('bukken/')) buildDoc(rel);
buildExtras();
buildSora();
process.exitCode = verify() ? 1 : 0;
