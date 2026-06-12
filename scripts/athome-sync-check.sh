#!/bin/bash
# athome-sync-check.sh
# athome 6リストページから物件IDを抽出し、athome-listings.json と比較して差分を通知する
# bash 3.2 互換

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LISTINGS_JSON="$SCRIPT_DIR/athome-listings.json"
LOG_FILE="$HOME/.claude/logs/meiji-athome-sync.log"
FAIL_FLAG="$HOME/.claude/logs/meiji-athome-sync.FAIL"

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
SHOP_ID="062449"

# ログ出力（2000行ローテ）
log() {
  local msg="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$msg"
  # ログファイルへ追記
  echo "$msg" >> "$LOG_FILE"
  # 2000行ローテ
  if [ -f "$LOG_FILE" ]; then
    local lines
    lines=$(wc -l < "$LOG_FILE")
    if [ "$lines" -gt 2000 ]; then
      local tmp
      tmp="$(mktemp)"
      tail -1800 "$LOG_FILE" > "$tmp"
      mv "$tmp" "$LOG_FILE"
    fi
  fi
}

# 通知（review-all-cron.sh と同じ方式）
notify() {
  local msg="$1"
  # osascript でMac通知（launchctl asuser 経由で実行されるため）
  local uid
  uid=$(id -u)
  if command -v osascript >/dev/null 2>&1; then
    launchctl asuser "$uid" osascript -e "display notification \"$msg\" with title \"明治不動産 物件同期チェック\"" 2>/dev/null || true
  fi
}

# ログディレクトリ確保
mkdir -p "$HOME/.claude/logs"

log "=== athome-sync-check START ==="

# 6リストページのURL
LIST_URLS=(
  "https://www.athome.co.jp/tochi/estate/${SHOP_ID}/list/"
  "https://www.athome.co.jp/kodate/estate/${SHOP_ID}/list/"
  "https://www.athome.co.jp/buy_store/estate/${SHOP_ID}/list/"
  "https://www.athome.co.jp/chintai/estate/${SHOP_ID}/list/"
  "https://www.athome.co.jp/rent_store/estate/${SHOP_ID}/list/"
  "https://www.athome.co.jp/rent_office/estate/${SHOP_ID}/list/"
)

# 現在のathomeから物件IDを収集
ATHOME_IDS_RAW=""
HTTP_FAIL=0

for url in "${LIST_URLS[@]}"; do
  log "Fetching: $url"
  response=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" -A "$UA" "$url" 2>/dev/null) || {
    log "ERROR: curl failed for $url"
    HTTP_FAIL=1
    continue
  }
  http_status=$(echo "$response" | grep "__HTTP_STATUS__" | sed 's/__HTTP_STATUS__//')
  body=$(echo "$response" | sed '/^__HTTP_STATUS__/d')

  if [ "$http_status" != "200" ]; then
    log "ERROR: HTTP $http_status for $url"
    HTTP_FAIL=1
    continue
  fi

  # bot-block検出: 認証ページ（"認証にご協力"が含まれる場合）は失敗扱い
  if echo "$body" | grep -q "認証にご協力\|window.onProtectionInitialized"; then
    log "ERROR: bot-blocked (JS challenge) for $url - marking as HTTP failure"
    HTTP_FAIL=1
    continue
  fi

  # 物件IDの抽出（/tochi/XXXXXXXXXX/ 形式の10桁数字）
  ids=$(echo "$body" | grep -oE '/(tochi|kodate|buy_store|chintai|rent_store|rent_office)/[0-9]{10}/' | grep -oE '[0-9]{10}' | sort -u)
  if [ -n "$ids" ]; then
    ATHOME_IDS_RAW="$ATHOME_IDS_RAW
$ids"
    count=$(echo "$ids" | grep -c "[0-9]" || echo 0)
    log "  Found $count IDs from $url"
  else
    log "  No IDs found from $url"
  fi
  sleep 1
done

if [ "$HTTP_FAIL" -eq 1 ]; then
  log "ERROR: HTTP failure detected. Exiting with code 2."
  echo "$(date '+%Y-%m-%d %H:%M:%S') HTTP failure" >> "$FAIL_FLAG"
  exit 2
fi

# 取得したID集合（重複排除・空行除去）
ATHOME_IDS=$(echo "$ATHOME_IDS_RAW" | grep -E '^[0-9]{10}$' | sort -u)

# listings.json から既知IDを取得（sale deal のみ）
if [ ! -f "$LISTINGS_JSON" ]; then
  log "ERROR: $LISTINGS_JSON not found"
  exit 2
fi

# pythonで listings.json から sale の athome_id を抽出（athome_url が設定されているもの）
KNOWN_IDS=$(python3 - <<'PYEOF'
import json, sys
with open('/Users/mto/meiji-fudosan/scripts/athome-listings.json') as f:
    data = json.load(f)
for item in data.get('listings', []):
    aid = item.get('athome_id', '')
    url = item.get('athome_url') or ''
    # 10桁数字のIDのみ（chintai_xxx 等のカスタムIDは除く）
    if aid.isdigit() and len(aid) == 10 and url:
        print(aid)
PYEOF
)

KNOWN_IDS=$(echo "$KNOWN_IDS" | sort -u)

log "Athome current IDs: $(echo "$ATHOME_IDS" | grep -c "[0-9]" || echo 0)"
log "Known IDs in listings.json: $(echo "$KNOWN_IDS" | grep -c "[0-9]" || echo 0)"

# 差分チェック
# 成約候補: listings.jsonにあるのにathomeで見つからないID
if [ -n "$ATHOME_IDS" ] && [ -n "$KNOWN_IDS" ]; then
  SOLD=$(comm -23 <(echo "$KNOWN_IDS") <(echo "$ATHOME_IDS"))
  ADDED=$(comm -13 <(echo "$KNOWN_IDS") <(echo "$ATHOME_IDS"))
else
  SOLD=""
  ADDED=""
fi

if [ -n "$SOLD" ] || [ -n "$ADDED" ]; then
  log "DIFF DETECTED"
  {
    echo "=== athome-sync-check diff $(date '+%Y-%m-%d %H:%M:%S') ==="
    if [ -n "$SOLD" ]; then
      echo ""
      echo "--- 成約の可能性（listings.jsonにあるがathomeから消えた）---"
      echo "$SOLD"
    fi
    if [ -n "$ADDED" ]; then
      echo ""
      echo "+++ 新規掲載の可能性（athomeにあるがlistings.jsonにない）+++"
      echo "$ADDED"
    fi
    echo ""
  } > "$FAIL_FLAG"
  log "FAIL flag written: $FAIL_FLAG"
  notify "物件情報に差分があります。ログを確認してください。"
else
  log "No diff. Removing FAIL flag if exists."
  rm -f "$FAIL_FLAG"
fi

log "=== athome-sync-check END ==="
