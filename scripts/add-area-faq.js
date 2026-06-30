#!/usr/bin/env node
// 5町ハブページ(土浦/つくば/かすみがうら/笠間/鉾田)に町ごとのFAQ(可視)+FAQPage(JSON-LD)を冪等挿入。
// 既にFAQPageがある(石岡/小美玉/茨城/baikyaku等)ページは対象外。再実行しても二重挿入しない。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 町ごとの一意なFAQ(回答先出し・地域性+問い合わせ意図)
const FAQ = {
  tsuchiura: [
    ['石岡市拠点とのことですが、土浦市の物件も任せられますか？',
     'はい。土浦市を含む周辺7市町に対応しています。地元の相場や取引実務を踏まえて、土地・中古戸建のご紹介から売却サポートまで承ります。'],
    ['霞ヶ浦周辺は浸水が心配です。リスクを確認できますか？',
     'はい。物件ごとにハザードマップ上の浸水・土砂災害区域を確認したうえでご案内します。低地・沿岸の物件は特に重視してご説明します。'],
    ['土浦市の不動産の売却・査定は無料ですか？',
     'はい。土地・中古戸建・空き家・相続した不動産の査定とご相談はすべて無料です。遠方の方やオンラインでのご相談にも対応します。'],
  ],
  tsukuba: [
    ['石岡市拠点ですが、つくば市の不動産も対応できますか？',
     'はい。つくば市を含む周辺エリアに対応しています。研究機関・企業関係者の方の住み替えや売却のご相談も承ります。'],
    ['転勤で短期間所有した家を売りたいのですが可能ですか？',
     'はい。住み替え・転勤に伴う売却の無料査定を承ります。住宅ローン残債がある場合のご相談にも対応します。'],
    ['つくばエクスプレス沿線でも物件を探せますか？',
     'ご希望のエリア・予算・通勤先を伺い、条件に合う土地・中古戸建をご提案します。非公開物件を含めてお探しします。'],
  ],
  kasumigaura: [
    ['石岡市拠点ですが、かすみがうら市の物件も対応できますか？',
     'はい。隣接するかすみがうら市の土地・中古戸建・農地の売買と売却に対応しています。'],
    ['霞ヶ浦近くの田舎暮らし向けの物件はありますか？',
     '霞ヶ浦東岸エリアの自然豊かな物件をお探しの方はご相談ください。市場に出る前の非公開物件を含めてご提案します。'],
    ['農地の売買や転用も相談できますか？',
     'はい。農地法に基づく手続き（3条・5条許可）を含め、農地の売買・転用を全面的にサポートします。'],
  ],
  kasama: [
    ['石岡市拠点ですが、笠間市の不動産も対応できますか？',
     'はい。常磐自動車道でつながる笠間市の土地・中古戸建の売買と売却に対応しています。'],
    ['笠間市への移住を考えています。相談できますか？',
     'はい。移住・二拠点生活向けの物件や、空き家の購入・活用についてもご相談ください。地元目線でご提案します。'],
    ['笠間市の不動産の売却・査定は無料ですか？',
     'はい。査定・ご相談は無料です。相続した不動産や空き家の整理もお任せください。'],
  ],
  hokota: [
    ['石岡市拠点ですが、鉾田市の不動産も対応できますか？',
     'はい。鉾田市の土地・農地・中古戸建の売買と売却に対応しています。'],
    ['農地や畑の売買・相続も相談できますか？',
     'はい。農地法の手続きを含め、農地・畑・原野の売買や相続にともなう整理をサポートします。'],
    ['鉾田市の物件を売りたいのですが査定は無料ですか？',
     'はい。査定・ご相談は無料です。遠方の方やオンラインでのご相談にも対応します。'],
  ],
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function visibleFaq(items) {
  const blocks = items.map(([q, a]) =>
`  <div class="faq-item">
    <div class="faq-q">${esc(q)}</div>
    <div class="faq-a">${esc(a)}</div>
  </div>`).join('\n');
  return `
<!-- FAQ:START -->
<section>
<h2>よくあるご質問</h2>
${blocks}
</section>
<!-- FAQ:END -->
`;
}

function faqJsonLd(items) {
  const main = items.map(([q, a]) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  }));
  const obj = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: main };
  return `
<script type="application/ld+json">
${JSON.stringify(obj, null, 2)}
</script>
`;
}

let changed = 0, skipped = 0;
for (const [town, items] of Object.entries(FAQ)) {
  const file = path.join(ROOT, town, 'index.html');
  if (!fs.existsSync(file)) { console.log(`SKIP(なし): ${town}`); continue; }
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('FAQPage') || html.includes('<!-- FAQ:START -->')) {
    console.log(`SKIP(既にFAQあり): ${town}`); skipped++; continue;
  }
  if (!html.includes('</body>')) { console.log(`SKIP(</body>無): ${town}`); continue; }

  // 可視FAQ: BUKKEN:END 直後に。無ければ最終cta-block(style無)の直前に。
  const endMarker = '<!-- BUKKEN:END -->';
  const finalCta = '<div class="cta-block">';
  if (html.includes(endMarker)) {
    html = html.replace(endMarker, endMarker + visibleFaq(items));
  } else if (html.includes('\n' + finalCta + '\n')) {
    html = html.replace('\n' + finalCta + '\n', visibleFaq(items) + '\n' + finalCta + '\n');
  } else {
    console.log(`SKIP(挿入位置不明): ${town}`); continue;
  }
  // FAQPage を </body> の直前に
  html = html.replace('</body>', faqJsonLd(items) + '</body>');

  fs.writeFileSync(file, html);
  console.log(`OK: ${town} (FAQ ${items.length}問 + FAQPage)`);
  changed++;
}
console.log(`\n--- 完了: 変更${changed}件 / スキップ${skipped}件 ---`);
