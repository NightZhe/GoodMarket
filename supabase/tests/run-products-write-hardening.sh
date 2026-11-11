#!/usr/bin/env bash
# products 寫入收斂：整套測試的執行腳本（隔離的本機實例用，別對正式站或共用實例跑）。
#
# 用法：DB_CONTAINER=<隔離實例的 db 容器名> supabase/tests/run-products-write-hardening.sh [--red]
#   例：DB_CONTAINER=supabase_db_goodmarket-pwh supabase/tests/run-products-write-hardening.sh | tee out.txt
#   --red  先在「套用前」的狀態（套 rollback.sql）跑一次主測試，印出失敗數，證明測試真的測得到東西
# 前提：資料庫已跑完 supabase/migrations 的全部 migration（含這支）；腳本最後會讓資料庫停在「已套用」狀態。
# 步驟：
#   1. 還原到套用前（rollback.sql）→ 記錄 verify 輸出（pre）
#   2. 套 migration 兩次（可重跑）→ 主測試（products_write_hardening.sql）
#   3. 套用後 verify → rollback → verify 要與 pre 完全一致 → 再套一次 migration，verify 要與套用後一致
#   4. VALIDATE 失敗情境：套用前塞壞列 → precheck → 套 migration（約束只能 NOT VALID）→ 斷言 → 清掉壞列 → 再套 → 全部 validated
set -euo pipefail

: "${DB_CONTAINER:?請設定 DB_CONTAINER（隔離實例的 db 容器，例如 supabase_db_goodmarket-pwh）}"
if [ "$DB_CONTAINER" = "supabase_db_GoodMarket" ] && [ "${FORCE_DEFAULT_INSTANCE:-}" != "1" ]; then
  echo "拒絕對預設實例 supabase_db_GoodMarket 執行（別的 session 可能在用）。請改用隔離實例。" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261111120000_products_write_hardening.sql"
OPS="$ROOT/supabase/ops/products-write-hardening"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

psql_() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
step() { printf '\n########## %s ##########\n' "$*"; }

step "1. 還原到套用前（rollback.sql）"
psql_ -q < "$OPS/rollback.sql"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_pre.json"
echo "pre summary: $(sed -E 's/.*("summary": \{[^}]*\}).*/\1/' "$TMP/verify_pre.json")"

if [ "${1:-}" = "--red" ]; then
  step "1b. 紅燈：套用前的狀態跑主測試（預期有大量失敗）"
  set +e
  psql_ < "$HERE/products_write_hardening.sql" 2>&1 | grep -E "^ +[0-9A-Za-z]+ +\| +[0-9]+ +\| +[0-9]+ +\| +[0-9]+ *$|有 [0-9]+ 項測試失敗|ERROR" | head -20
  set -e
fi

step "2a. 套 migration（第一次）"
psql_ -q < "$MIG"
step "2b. 套 migration（第二次：可重跑）"
psql_ -q < "$MIG"
echo "兩次都成功"

step "2c. 主測試"
psql_ < "$HERE/products_write_hardening.sql"

step "3a. 套用後 verify"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_post.json"
cat "$TMP/verify_post.json"

step "3b. rollback → verify 與套用前一致？"
psql_ -q < "$OPS/rollback.sql"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_after_rb.json"
if diff "$TMP/verify_pre.json" "$TMP/verify_after_rb.json" > "$TMP/diff.txt"; then
  echo "PASS：rollback 後的 verify 輸出與套用前逐字相同"
else
  echo "FAIL：rollback 後與套用前不同"; cat "$TMP/diff.txt"; exit 1
fi
step "3c. rollback 之後再套一次 migration"
psql_ -q < "$MIG"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_post2.json"
if diff "$TMP/verify_post.json" "$TMP/verify_post2.json" > /dev/null; then
  echo "PASS：再套用後的 verify 輸出與第一次套用後相同"
else
  echo "FAIL：再套用後與第一次不同"; exit 1
fi

step "4a. VALIDATE 失敗情境：還原 → 塞 18 筆壞列＋1 筆好列 → precheck"
psql_ -q < "$OPS/rollback.sql"
psql_ -q < "$HERE/products_write_hardening_validate_seed.sql"
psql_ -At < "$OPS/precheck.sql" > "$TMP/precheck.json"
cat "$TMP/precheck.json"; echo
step "4b. 套 migration（預期成功並發出 WARNING；約束不 validated）"
psql_ < "$MIG" 2>&1 | grep -E "WARNING|COMMIT|ERROR|ROLLBACK"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_vf.json"
echo "verify summary: $(sed -E 's/.*("summary": \{[^}]*\}).*/\1/' "$TMP/verify_vf.json")"
echo "verify constraints: $(jq -c '.constraints[] | select(.name|test("shape|len")) | {name, validated}' "$TMP/verify_vf.json" | tr '\n' ' ')"
step "4c. 斷言"
psql_ -v precheck="$(cat "$TMP/precheck.json")" -v verify="$(cat "$TMP/verify_vf.json")" < "$HERE/products_write_hardening_validate_check.sql"
step "4d. 清掉壞列、再套 migration → 全部 validated"
psql_ -q -c "delete from auth.users where id = 'dddddddd-0000-4000-8000-000000000001'"
psql_ -q < "$MIG"
psql_ -At < "$OPS/verify.sql" > "$TMP/verify_final.json"
echo "final summary: $(sed -E 's/.*("summary": \{[^}]*\}).*/\1/' "$TMP/verify_final.json")"
if diff "$TMP/verify_post.json" "$TMP/verify_final.json" > /dev/null; then echo "PASS：最終狀態與第一次套用後相同"; else echo "FAIL"; exit 1; fi
psql_ -At < "$OPS/precheck.sql"
echo
echo "全部完成；資料庫停在「已套用」狀態。"
