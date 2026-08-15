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
