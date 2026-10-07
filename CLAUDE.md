# 明治不動産 ホームページ

クライアント案件。明治不動産のコーポレートサイト。

## スタック
- 静的HTML / CSS / JavaScript（フレームワークなし）

## ファイル構成
```
index.html      # メインページ
admin.html      # 管理ページ
sitemap.xml     # サイトマップ
robots.txt      # クローラー設定
```

## 注意
- Google Search Console認証済み（google58922da62ae13e77.html）
- シンプルな静的サイト。余計なフレームワーク不要

## CI（公開前の関門）— 2026-08-15 owner決定「このまま」

`.github/workflows/verify.yml` が push 時に走る。**`site-health.test.mjs` を repo scope で通す**。
- **掲載データが30日より古いと赤**。現在63日前(2026-06-13取得)so、**次の push は赤になる**。
  これは意図どおり——成約・取り下げになった物件が載り続けたまま公開されるのを止めている。
  コードの故障ではない。
- **解除**: `bash scripts/athome-sync-check.sh` で掲載情報を更新してコミットする
  （外部サイトへアクセスするのでownerの判断が要る）
- CIで判定できないもの（launchd登録）は `SITE_HEALTH_SCOPE` で分離。
  **判定しなかった項目はスクリプト自身が名前を出す**（黙って飛ばした＝異常なし、にしない）

## 物件・実績の運用（2026-10-07 整備）
- **物件の鮮度**: `scripts/athome-sync-check.sh` が毎日7:30にlaunchd(`com.mto.meiji-athome-sync`)で走り、athome自社掲載のIDをSafari経由で取得して `scripts/athome-listings.json` と突き合わせる。**差分があると `~/.claude/logs/meiji-athome-sync.FAIL` が立ち通知される**（成約=サイトに載っているのにathomeに無い／新規=athomeにあるのにサイトに無い）。
  - 検知だけで自動修正はしない。差分が出たら: Safariで該当物件の詳細を取り直し→ `scripts/athome-details.json` と `athome-listings.json`（`scraped_at` も）を更新 → `node scripts/build-bukken.js` → push。成約済みの `/bukken/<id>/` は消す（生成器は消さない）。
  - 射程外: 価格・面積などの**内容の変化は検知しない**（IDの増減だけ）。Playwright版(`athome-fetch-ids.js`)はathomeのbot判定で0件になるため使わない。
  - 取得は一覧4ページ・1日1回、取得するのはIDのみ。athome公開の利用条件(消費者向けページ・2026-10-07確認)に自動アクセスを禁じる文言は無いが、複製・転載には事前の許諾が必要とある。**加盟店契約でどうなっているかは未確認**＝ownerがathomeに確認すること。launchdはログイン中のMacが起きている時だけ動く（電源OFF・ログアウト中は次回まで飛ぶ）。初回はSafariのAutomation許可ダイアログが出ることがある。
- **取り扱い実績**: `scripts/jisseki.json`（ローカルのみ・.gitignore済み。Pagesは全ファイルを配信するため公開しない）の `confirmed:true` の事例だけが `node scripts/build-jisseki.js` で `/jisseki/` に出る。0件ならページは作られない。**架空の事例は書かない**。成約・取り下げの事実と、売主買主が特定されない表現かをownerが確認してから `confirmed` を true にする。
- **FAQPage JSON-LDは入れない**（Google公式: FAQリッチリザルトは2023年から政府・医療サイトに限定、2026年5月7日からGoogle検索に表示されなくなった=確認2026-10-07。本文との二重管理が不整合の源になった。ChatGPTが一度「2026年廃止は不正確」と言ったが、公式ページは両方を書いている）。
- 営業時間は10:00〜17:00（日曜・祝日休み・土曜は営業）。免許番号は更新（2027年2月）で変わる可能性があるため、変わったら全ページのフッター・JSON-LD・`scripts/build-bukken.js`を直す。

## 進め方（owner厳命 2026-10-07「全てにおいて、必ずchatgptと議論して進めてくれや」）
- **方針・設計・優先順位・文面の判断は、実装の前に必ずChatGPTと議論する**（指示待ちにしない・「議論して」と言われなくてもやる）。測定や調査は先にやってよいが、**その結果を見せて優先順位を決めてもらってから**施策に入る。
- 投げ方: 実測値と自分の仮説を明示し「忖度不要・間違っていれば間違いと言え」を付ける。回答は鵜呑みにせず実データ・一次情報と突き合わせる（今日だけで、ChatGPTが「免許(3)は矛盾」と言ったのを私が「矛盾とは言えない」と訂正された例、私の計画の順序をChatGPTに逆と指摘された例がある）。
- 経路: `bash ~/.claude/bin/safari-chatgpt.sh <prompt.txt> --new`（Safari・返答まで1〜2分。**応答が10分以上無い時は `pkill -f safari-chatgpt.sh` して1回だけやり直す**）。コードの検証はCodex(`codex-verify.sh`)、方針と事実はChatGPT。

## SEO/AEO（2026-10-07 ChatGPT議論＋実測で確定）
- **実測(Lighthouse mobile・2026-10-07)**: トップ/石岡/会社概要/物件個別 すべて Accessibility・Best Practices・SEO・Agentic Browsing = 100。`chrome-devtools` MCPの `lighthouse_audit` で測る（パフォーマンス/CWVは別: `performance_start_trace`・**未測定**）。
- **やらない**（ChatGPT・Google公式。ブログ由来は仮説扱い）: llms.txt / AI専用schema / FAQ大量設置 / meta descriptionの文字数合わせ(Googleに固定文字数の規則は無い・Search ConsoleでCTR異常が出たページだけ直す) / 地域×ニーズの新規ページ量産(Search Consoleで需要を見るまで止める＝doorway/scaled content化のリスク) / JSON-LDにページ上に無い事実を書く / sameAsの追加(アットホーム・GBPの営業時間が直るまで)。
- **次の最優先は計測**: **Search Console の実データ（過去16か月の ページ×クエリ別 表示・クリック・CTR・順位／インデックス状況／URL検査でGoogleが選んだcanonical）を owner が書き出す**。私はSearch Consoleに入れない。GA4(gtag G-7YHR1QE05T)でChatGPT流入は `utm_source=chatgpt.com` で見える。
- **P0（SEO施策の前提）**: アットホーム(営業時間16:00・定休に土曜の誤り)・Googleビジネスプロフィール(未確認)・自社サイトの会社情報を**1つの事実に揃える**。免許番号「茨城県知事免許(3)第6811号」は県の公表資料(令和7年2月28日付・免許年月日 令和4年2月17日)・アットホーム・自社サイトの3つで一致済み＝確認不要(10/7 ownerの指摘。ChatGPTが言った『県の別ページは(6)表記』は私が未確認のまま宿題にしてしまった誤り。次回更新2027年2月で番号が変わったら直す)。
- AEOの検証は「GSC＋GA4のChatGPT流入＋ChatGPT/Perplexity/Google AIモードに定点質問して引用元を記録」。業者独自の「AEOスコア」はKPIにしない。
- **canonical統合は撤回済み(10/7夜)**: `ibaraki/business-land`(茨城県の事業用地)は自己canonical。Search Consoleで22クリック・361表示の実績があり、検索意図(県全域)が石岡市ページと別。**実績のあるURLを統合・削除する前に、必ずSearch Consoleのページ別実績を見る**。
- sitemapの `lastmod` は `node scripts/build-sitemap-lastmod.js`（build-bukken.jsの後に実行）。ページのファイルを最後に変えたコミットの日付。共通CSSだけの変更は反映されない。

## Search Console実測（2026-10-07・ownerのSafariログインで閲覧のみ・プロパティ https://meijifudosan.com/）
- 2026/4/23〜10/4: 296クリック・7,460表示・CTR 4%・平均順位18.5。**クリックの大半は社名の指名検索**（「明治不動産」37/292、「明治不動産 石岡」25/81）。一般語の表示は「八郷 空き家バンク」156・「八郷 古民家 物件」51・「石岡市 空き家」50 など（順位が低くクリックほぼ0）。
- ページ別: トップ157クリック/1,727表示、/ishioka/akiya/ 27/888、/ibaraki/business-land/ 22/361、/omitama/land/ 18/1,131、/omitama/used-house/ 10/911。
- **インデックス**: 登録済み19・未登録17。未登録のうち15は `/bukken/<id>/` 個別ページで「検出 - インデックス未登録」（2026/5/5に検出されてから**一度もクロールされていない**）。原因はクロール予算ではなくcrawl demand（内部リンクが弱い・アットホーム転載で独自価値が薄い）と見る（ChatGPT・Google公式。34URLの小規模サイトではクロール予算は主因でない）。対策=ヘッダーの『物件一覧』を/bukken/へ・各物件ページに公式情報ベースの確認ポイントを追加。**効果の確認=2〜4週間後にGSCで個別ページのクロール状況を見る**。
- 古民家の旧URL(/ishioka/kominka/ ほか)は「古民家は提供しない」とownerが決めて404（意図的）。Googleの記録が残っているだけ。sitemap・内部リンクに無いことだけ守る。
- sitemap: 送信済み・成功。パンくず: 有効14・エラー0。CWV: トラフィック不足でデータなし。GSCのメッセージ8件は未読のまま未確認（セキュリティ・手動対策の通知が無いかを先に見る）。
- 次の候補（ChatGPT順）: ①3〜5物件を独自化してindex実験→URL検査から登録リクエスト（**ownerの操作が要る**） ②/ishioka/akiya/ の八郷強化（実施済み・順位変化を見る） ③既存の表示がある /omitama/land/ /omitama/used-house/ を5〜15位に押し上げる（GSCでページ別の検索語を見てから）。やらない: 市町×種別の大量ページ・AIで地域紹介の量産・インデックス未登録URLを毎日登録リクエスト。
