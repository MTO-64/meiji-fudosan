# 明治不動産サイト刷新の本番統合
## Contract
入力=scripts/athome-*.json と content/(旧形式の正本HTML)。`node src-site/build.mjs` で新デザインを repo 直下へ出力する。
完了=本番用コミットが branch site-renewal に固定され、下の検証が全部通り、owner の「公開して」待ち。main・origin には触らない。
## Invariants
- 既存36URLのURL/title/description/canonical/robots/JSON-LD/h1/内部リンクを変えない(verify 差分0)。site-health 全PASS。
- 更新は データ→content→新デザイン の一方向。build-bukken.js は content/ へ書く。2回連続ビルドで差分0。旧デザインが直下に再出現しない。
- 物件詳細・一覧は実データだけ。AI写真を物件の隣や詳細に置かない。実在の事務所に見えるAI写真を使わない。
- 秘密ファイルを読まない。Web3Formsの公開キーは正本HTMLから抽出し、チャットに出さない。
- 外部送信をしない(実送信テストは owner 承認後)。
## Edge cases
物件1件の増減/価格変更、成約で個別ページ削除、フォーム失敗・bot、JS無効・動きを減らす、Web3Forms到達不能、/content/ の検索露出。
## Verification plan
- build.mjs の verify / check.mjs / site-health(scope=repo)
- rebuild.test.mjs: 価格変更と物件削除が新デザインに反映され、元へ戻すと差分0、2回ビルド差分0
- フォーム: Playwright で送信を横取りし項目を検査(実送信はしない)。失敗時に電話案内
- 速度: トップ/akiya/business-land/omitama-land/物件/contact/sora を Lighthouse・転送量で実測
- Codex: このspecとの照合 / Safari 目視 / JS無効で本文が読める
