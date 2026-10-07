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
- **取り扱い実績**: `scripts/jisseki.json` の `confirmed:true` の事例だけが `node scripts/build-jisseki.js` で `/jisseki/` に出る。0件ならページは作られない。**架空の事例は書かない**。成約・取り下げの事実と、売主買主が特定されない表現かをownerが確認してから `confirmed` を true にする。
- **FAQPage JSON-LDは入れない**（Googleが2026年にFAQリッチリザルトを終了。本文との二重管理が不整合の源になった）。
- 営業時間は10:00〜17:00（日曜・祝日休み・土曜は営業）。免許番号は更新（2027年2月）で変わる可能性があるため、変わったら全ページのフッター・JSON-LD・`scripts/build-bukken.js`を直す。
