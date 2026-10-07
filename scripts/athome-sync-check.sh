#!/bin/bash
# athome-sync-check.sh
# athome の自社掲載物件IDを Playwright(athome-fetch-ids.js) で取得し、
# scripts/athome-listings.json の既知ID集合と比較して差分(成約=消滅 / 新規)を通知する。
# 差分や取得失敗は FAIL フラグ + 通知。差分なしならフラグ削除。
# bash 3.2 互換。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LISTINGS_JSON="$SCRIPT_DIR/athome-listings.json"
LOG_FILE="$HOME/.claude/logs/meiji-athome-sync.log"
FAIL_FLAG="$HOME/.claude/logs/meiji-athome-sync.FAIL"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"

mkdir -p "$HOME/.claude/logs"

log() {
  msg="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
  if [ -f "$LOG_FILE" ]; then
    lines=$(wc -l < "$LOG_FILE")
    if [ "$lines" -gt 2000 ]; then
      tmp="$(mktemp)"
      tail -1800 "$LOG_FILE" > "$tmp" && mv "$tmp" "$LOG_FILE"
    fi
  fi
}

notify() {
  uid=$(id -u)
  if command -v osascript >/dev/null 2>&1; then
    launchctl asuser "$uid" osascript -e \
      "display notification \"$1\" with title \"明治不動産 物件同期チェック\" sound name \"Basso\"" 2>/dev/null || true
  fi
}

log "=== athome-sync-check START ==="

if [ ! -f "$LISTINGS_JSON" ]; then
  log "ERROR: $LISTINGS_JSON not found"
  printf '%s athome-sync: listings.json missing\n' "$(date '+%Y-%m-%d %H:%M:%S')" > "$FAIL_FLAG"
  exit 2
fi

# 1. athome から現掲載IDを取得（headful Playwright）。出力は "category:ID" の各行。
# 既定は Safari 経由(Playwright版は athome の bot 判定で0件になる=2026-10-07 実測)。ATHOME_FETCHER=athome-fetch-ids.js で旧版に戻せる。
FETCHER="${ATHOME_FETCHER:-athome-fetch-ids-safari.js}"
FETCH_OUT="$(cd "$PROJECT_DIR" && "$NODE_BIN" "scripts/$FETCHER" 2>>"$LOG_FILE")"
FETCH_RC=$?
if [ "$FETCH_RC" -ne 0 ]; then
  log "ERROR: fetch failed (rc=$FETCH_RC). Marking FAIL (取得不能 — 成約と誤判定しない)."
  printf '%s athome-sync: fetch failed rc=%s（取得不能・要確認）\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$FETCH_RC" > "$FAIL_FLAG"
  notify "athome 取得に失敗しました。ログを確認してください。"
  exit 2
fi

ATHOME_IDS=$(printf '%s\n' "$FETCH_OUT" | sed -n 's/^[a-z_]*:\([0-9]\{8,\}\)$/\1/p' | sort -u)
ATHOME_COUNT=$(printf '%s\n' "$ATHOME_IDS" | grep -c '[0-9]')
log "athome current numeric IDs: $ATHOME_COUNT"

if [ "$ATHOME_COUNT" -eq 0 ]; then
  log "ERROR: 0 IDs parsed despite rc=0 — treat as failure."
  printf '%s athome-sync: 0 IDs parsed（取得不能・要確認）\n' "$(date '+%Y-%m-%d %H:%M:%S')" > "$FAIL_FLAG"
  notify "athome から物件IDを取得できませんでした。"
  exit 2
fi

# 2. listings.json の既知数値ID（chintai_xxx 等のカスタムIDは除外）
KNOWN_IDS=$("$NODE_BIN" -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const s = new Set();
  (d.listings || []).forEach(l => {
    const id = String(l.athome_id || "");
    if (/^[0-9]{8,}$/.test(id)) s.add(id);
  });
  [...s].sort().forEach(x => console.log(x));
' "$LISTINGS_JSON" | sort -u)
KNOWN_COUNT=$(printf '%s\n' "$KNOWN_IDS" | grep -c '[0-9]')
log "known numeric IDs in listings.json: $KNOWN_COUNT"

# 3. 差分（SOLD=消えた=成約候補 / ADDED=新規掲載）
SOLD=$(comm -23 <(printf '%s\n' "$KNOWN_IDS") <(printf '%s\n' "$ATHOME_IDS"))
ADDED=$(comm -13 <(printf '%s\n' "$KNOWN_IDS") <(printf '%s\n' "$ATHOME_IDS"))

if [ -n "$SOLD" ] || [ -n "$ADDED" ]; then
  log "DIFF DETECTED"
  {
    echo "=== athome-sync diff $(date '+%Y-%m-%d %H:%M:%S') ==="
    if [ -n "$SOLD" ]; then
      echo ""
      echo "--- 成約の可能性（サイト掲載中だが athome から消えた）→ /bukken/<id>/ を非公開に ---"
      echo "$SOLD"
    fi
    if [ -n "$ADDED" ]; then
      echo ""
      echo "+++ 新規掲載（athome にあるがサイト未掲載）→ ページ生成候補 +++"
      echo "$ADDED"
    fi
  } > "$FAIL_FLAG"
  log "FAIL flag written: $FAIL_FLAG"
  notify "物件に差分があります（成約/新規）。ログを確認してください。"
else
  log "No diff (sync OK). Removing FAIL flag if present."
  rm -f "$FAIL_FLAG"
fi

log "=== athome-sync-check END ==="
exit 0
