#!/usr/bin/env bash
# 明治不動産 admin 環境の一発デプロイスクリプト
#   1) Supabase Edge Function secrets (MEIJI_PUBLISH_PW_HASH / MEIJI_GITHUB_TOKEN) を設定
#   2) ローカルの admin.html を GitHub に commit (本番反映)
#
# 別アプリの「ターミナル.app」で実行してください(チャット欄からは絶対に実行しない)。
#
# 使い方:
#   bash /Users/mto/meiji-fudosan/setup-secrets.sh
#
# 必要:
#   - 環境変数 SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)
#       未設定なら以下を実行してから本スクリプトを再実行:
#         read -s tok && export SUPABASE_ACCESS_TOKEN="$tok" && unset tok
#   - GitHub Personal Access Token (repo scope)
#       https://github.com/settings/tokens/new?scopes=repo&description=meiji-fudosan-publish

set -euo pipefail

# ---- secret 取得元優先順位 ----
#   1) shell env (MEIJI_PUBLISH_PW_HASH を export 済み)
#   2) ./.env.local （gitignore 対象、ローカル開発用）
#   3) 上記いずれもなし → エラーで停止
# canonical store: パスワードマネージャの "明治不動産 admin" エントリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${MEIJI_PUBLISH_PW_HASH:-}" && -f "$SCRIPT_DIR/.env.local" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.local"
fi
: "${MEIJI_PUBLISH_PW_HASH:?ERROR: MEIJI_PUBLISH_PW_HASH 未設定。.env.local を作るか shell env で export}"

PROJECT_REF="${SUPABASE_PROJECT_REF:?ERROR: SUPABASE_PROJECT_REF 未設定。.env.local に SUPABASE_PROJECT_REF=<ref> を書くか shell env で export してください}"
REPO_OWNER="MTO-64"
REPO_NAME="meiji-fudosan"
ADMIN_FILE="$SCRIPT_DIR/admin.html"

SECRETS_API="https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets"
ADMIN_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/admin.html"

# ---- 事前チェック ----
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  cat >&2 <<'EOF'
ERROR: SUPABASE_ACCESS_TOKEN が未設定です。

1) https://supabase.com/dashboard/account/tokens で Personal Access Token を生成
2) このターミナルで:
     read -s tok && export SUPABASE_ACCESS_TOKEN="$tok" && unset tok
3) もう一度本スクリプトを実行
EOF
  exit 1
fi

if [[ ! -f "$ADMIN_FILE" ]]; then
  echo "ERROR: $ADMIN_FILE が見つかりません" >&2
  exit 1
fi

# ---- GitHub PAT 入力 ----
echo "GitHub Personal Access Token を入力してください (画面非表示):"
echo "(scope: repo / 生成: https://github.com/settings/tokens/new?scopes=repo&description=meiji-fudosan-publish )"
IFS= read -rs GH_TOK
echo
if [[ -z "${GH_TOK}" ]]; then
  echo "ERROR: トークンが空です。中止しました。" >&2
  exit 1
fi

# ---- 作業ディレクトリ (全一時ファイルをまとめて削除できるように) ----
WORK=$(mktemp -d -t meiji-deploy.XXXXXX)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# ============================================================
# Step 1: Supabase Edge Function secrets を設定
# ============================================================
echo "[1/2] Supabase secrets を設定中..."

cat > "$WORK/secrets.json" <<EOF
[
  {"name": "MEIJI_PUBLISH_PW_HASH", "value": "${MEIJI_PUBLISH_PW_HASH}"},
  {"name": "MEIJI_GITHUB_TOKEN", "value": "${GH_TOK}"}
]
EOF

SECRETS_CODE=$(curl -sS \
  -o "$WORK/secrets-resp.txt" \
  -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@$WORK/secrets.json" \
  "$SECRETS_API")

case "$SECRETS_CODE" in
  200|201|204)
    echo "    ✓ MEIJI_PUBLISH_PW_HASH と MEIJI_GITHUB_TOKEN を設定しました"
    ;;
  *)
    echo "    ERROR: Supabase API (HTTP $SECRETS_CODE)" >&2
    cat "$WORK/secrets-resp.txt" >&2; echo >&2
    echo "    対処: 401=SUPABASE_ACCESS_TOKEN無効, 403=権限不足, 404=PROJECT_REF違い" >&2
    unset GH_TOK
    exit 2
    ;;
esac

# ============================================================
# Step 2: admin.html を GitHub に commit
# ============================================================
echo "[2/2] admin.html を本番に commit 中..."

# 既存ファイルの SHA を取得 (404 = 新規作成扱い)
SHA_CODE=$(curl -sS \
  -o "$WORK/gh-get.json" \
  -w "%{http_code}" \
  -H "Authorization: token ${GH_TOK}" \
  -H "Accept: application/vnd.github.v3+json" \
  "$ADMIN_API")

SHA=""
if [[ "$SHA_CODE" == "200" ]]; then
  SHA=$(python3 -c "import json,sys; d=json.load(open('$WORK/gh-get.json')); print(d.get('sha',''))")
elif [[ "$SHA_CODE" != "404" ]]; then
  echo "    ERROR: GitHub GET 失敗 (HTTP $SHA_CODE)" >&2
  cat "$WORK/gh-get.json" >&2; echo >&2
  unset GH_TOK
  exit 3
fi

# admin.html を base64 化 (macOS BSD と GNU coreutils 両対応のため stdin 経由)
base64 < "$ADMIN_FILE" | tr -d '\n' > "$WORK/admin-b64.txt"
ADMIN_B64=$(<"$WORK/admin-b64.txt")
DATE=$(date +%Y-%m-%d)

# PUT body を構築 (Python で安全にJSONエンコード)
python3 - "$WORK/put-body.json" "$DATE" "$SHA" "$ADMIN_B64" <<'PYEOF'
import json, sys
out, date, sha, content = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
body = {"message": f"admin.html 更新 {date} (setup-secrets.sh)", "content": content}
if sha:
    body["sha"] = sha
with open(out, "w") as f:
    json.dump(body, f)
PYEOF

PUT_CODE=$(curl -sS \
  -o "$WORK/gh-put-resp.json" \
  -w "%{http_code}" \
  -X PUT \
  -H "Authorization: token ${GH_TOK}" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  --data-binary "@$WORK/put-body.json" \
  "$ADMIN_API")

unset GH_TOK

case "$PUT_CODE" in
  200|201)
    echo "    ✓ admin.html を commit しました (1〜2分で https://meijifudosan.com/admin.html に反映)"
    ;;
  *)
    echo "    ERROR: GitHub PUT 失敗 (HTTP $PUT_CODE)" >&2
    cat "$WORK/gh-put-resp.json" >&2; echo >&2
    exit 4
    ;;
esac

echo ""
echo "✅ 全工程完了。1〜2分後、ブラウザで https://meijifudosan.com/admin.html にアクセスし、"
echo "   ログイン → 編集 → 「🚀 サイトに反映」ボタンで自動反映されることを確認してください。"
