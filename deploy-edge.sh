#!/usr/bin/env bash
# 明治不動産 Edge Function (meiji-publish) を Supabase に再デプロイする。
#
# 別アプリの「ターミナル.app」で実行してください(チャット欄からは絶対に実行しない)。
#
# 使い方:
#   bash /Users/mto/meiji-fudosan/deploy-edge.sh
#
# 必要:
#   - 環境変数 SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)
#       未設定なら以下を実行してから本スクリプトを再実行:
#         read -s tok && export SUPABASE_ACCESS_TOKEN="$tok" && unset tok
#   - SUPABASE_PROJECT_REF (.env.local または shell env)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.local"
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:?ERROR: SUPABASE_PROJECT_REF 未設定。.env.local に SUPABASE_PROJECT_REF=<ref> を書くか shell env で export してください}"
FN_NAME="meiji-publish"
FN_DIR="$SCRIPT_DIR/edge-functions/$FN_NAME"
ENTRY="$FN_DIR/index.ts"

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

if [[ ! -f "$ENTRY" ]]; then
  echo "ERROR: $ENTRY が見つかりません" >&2
  exit 1
fi

WORK=$(mktemp -d -t meiji-deploy-edge.XXXXXX)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Supabase Management API multipart payload
# 参照: https://supabase.com/docs/reference/api/v1-deploy-a-function
echo "Edge Function ($FN_NAME) を deploy 中..."

DEPLOY_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${FN_NAME}"

# metadata.json: name + entrypoint(import_map相対パス) + verify_jwt
cat > "$WORK/metadata.json" <<EOF
{
  "name": "${FN_NAME}",
  "entrypoint_path": "index.ts",
  "verify_jwt": false
}
EOF

# トークンを引数ではなくヘッダーファイル経由で渡す (ps aux に出さないため)
# umask はサブシェルに閉じて、後続ファイル(metadata.json 等)の権限に影響させない。
AUTH_HEADER_FILE="$WORK/auth.txt"
( umask 077; printf 'Authorization: Bearer %s\n' "${SUPABASE_ACCESS_TOKEN}" > "$AUTH_HEADER_FILE" )

DEPLOY_CODE=$(curl -sS \
  -o "$WORK/deploy-resp.json" \
  -w "%{http_code}" \
  -X POST \
  -H "@${AUTH_HEADER_FILE}" \
  -F "metadata=@$WORK/metadata.json;type=application/json" \
  -F "file=@${ENTRY};type=application/typescript" \
  "$DEPLOY_URL")

# 即座に消す (trap でも消えるが念のため)
rm -f "$AUTH_HEADER_FILE"

case "$DEPLOY_CODE" in
  200|201)
    echo "    ✓ $FN_NAME を deploy しました"
    cat "$WORK/deploy-resp.json"; echo
    ;;
  *)
    echo "    ERROR: deploy 失敗 (HTTP $DEPLOY_CODE)" >&2
    cat "$WORK/deploy-resp.json" >&2; echo >&2
    echo "    対処: 401=SUPABASE_ACCESS_TOKEN無効, 403=権限不足, 404=PROJECT_REF違い" >&2
    exit 2
    ;;
esac

echo ""
echo "✅ deploy 完了。"
echo "   ヘルスチェック:"
echo "     curl -sS -X POST -H 'Content-Type: application/json' \\"
echo "       --data '{\"password\":\"x\",\"content\":\"const x=(\",\"filename\":\"properties-data.js\"}' \\"
echo "       https://${PROJECT_REF}.supabase.co/functions/v1/${FN_NAME}"
echo "   → 期待: HTTP 400 \"JavaScript構文エラー\""
