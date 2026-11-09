#!/usr/bin/env bash
# 封存 iOS App 殼並（可選）上傳 TestFlight。只能在 macOS＋Xcode 的機器上跑。
#
# 用法（在 repo 根目錄、最新 main 的乾淨 checkout 或 worktree）：
#   scripts/archive-ios.sh            建置網頁 → cap sync → 驗證 bundle → xcodebuild archive，印出上傳指令
#   scripts/archive-ios.sh --upload   同上，最後直接 -exportArchive 上傳 App Store Connect
#
# 流程與檢查項目來自 docs/STATUS.md「封存／上傳流程」與 build 3／build 4 的教訓：
#   - 不能有 .env.local（Vite 會拿它蓋過 .env，把本機 Supabase 網址打包進 App）
#   - bundle 裡必須有正式站 Supabase 網域與 Turnstile sitekey，不能有 127.0.0.1:54321
#   - worktree 用 symlink node_modules 時 cap sync 會把 Package.swift／settings.gradle 的相對路徑改掉，要還原
set -euo pipefail

UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    *) echo "未知參數：$arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TEAM_ID=F7WL42HXND
PROD_SUPABASE_HOST=hvecvwzpummmlsakxqbw.supabase.co
PROJECT=ios/App/App.xcodeproj
SCHEME=App
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="ios/App/output/$STAMP"   # ios/.gitignore 已排除 App/output

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

# ---- 前置檢查 -------------------------------------------------------------
[ "$(uname -s)" = Darwin ] || fail "只能在 macOS 上封存（需要 Xcode）"
command -v xcodebuild >/dev/null || fail "找不到 xcodebuild"
command -v npm >/dev/null || fail "找不到 npm"

[ ! -e .env.local ] || fail "有 .env.local，會蓋過 .env 把本機網址打包進 App。請在沒有 .env.local 的 worktree 封存（見 CLAUDE.md）"
[ -f .env ] || fail "缺 .env（正式站 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY／VITE_TURNSTILE_SITEKEY）"
grep -q "VITE_SUPABASE_URL=https://$PROD_SUPABASE_HOST" .env || fail ".env 的 VITE_SUPABASE_URL 不是正式站 $PROD_SUPABASE_HOST"
SITEKEY="$(sed -n 's/^VITE_TURNSTILE_SITEKEY=//p' .env | tr -d '"\r')"
[ -n "$SITEKEY" ] || fail ".env 缺 VITE_TURNSTILE_SITEKEY"
ok "環境變數：正式站 Supabase、Turnstile sitekey ${SITEKEY:0:6}…"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "工作樹有未提交的變更，請先 commit 或 stash，封存要對得上一個 commit"
fi
GIT_SHA="$(git rev-parse --short HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ok "封存來源：$GIT_BRANCH $GIT_SHA"

# ---- 建置網頁、同步原生專案 ---------------------------------------------
npm run build
npx cap sync

# symlink node_modules 的 worktree：cap sync 會把路徑解析到 worktree 外，還原成版控裡的相對路徑
if ! git diff --quiet -- ios/App/CapApp-SPM/Package.swift android/capacitor.settings.gradle; then
  git checkout -- ios/App/CapApp-SPM/Package.swift android/capacitor.settings.gradle
  ok "cap sync 改寫了 Package.swift／capacitor.settings.gradle 的路徑，已還原"
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "cap sync 之後原生專案有漂移，請先檢查 git diff 並提交"

# ---- 驗證打包進 App 的網頁資源 -------------------------------------------
ASSETS=ios/App/App/public/assets
[ -d "$ASSETS" ] || fail "找不到 $ASSETS，cap sync 沒有複製網頁資源"
if grep -l "127\.0\.0\.1:54321" "$ASSETS"/*.js >/dev/null 2>&1; then
  fail "bundle 內嵌本機 Supabase 網址 127.0.0.1:54321，不能上傳"
fi
grep -l "$PROD_SUPABASE_HOST" "$ASSETS"/*.js >/dev/null || fail "bundle 沒有正式站 Supabase 網域"
grep -l "$SITEKEY" "$ASSETS"/*.js >/dev/null || fail "bundle 沒有 Turnstile sitekey"
grep -q '"CAPCameraPlugin"' ios/App/App/capacitor.config.json || fail "capacitor.config.json 沒有 camera 外掛"
ok "bundle 驗證：只有正式站網域、有 sitekey、無本機位址；外掛清單含 camera"

# ---- 封存 -----------------------------------------------------------------
mkdir -p "$OUT"
printf '%s %s\n' "$GIT_BRANCH" "$GIT_SHA" > "$OUT/source-commit.txt"
echo "▶ xcodebuild archive → $OUT/App.xcarchive"
xcodebuild archive \
  -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  | tail -20
[ -d "$OUT/App.xcarchive" ] || fail "封存失敗"
ok "封存完成：$OUT/App.xcarchive"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>upload</string>
	<key>teamID</key><string>$TEAM_ID</string>
	<key>manageAppVersionAndBuildNumber</key><true/>
	<key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

EXPORT_CMD="xcodebuild -exportArchive -archivePath \"$OUT/App.xcarchive\" -exportOptionsPlist \"$OUT/ExportOptions.plist\" -exportPath \"$OUT/export\" -allowProvisioningUpdates"

if [ "$UPLOAD" = 1 ]; then
  echo "▶ 上傳 App Store Connect（build 號由 ASC 自動配）"
  eval "$EXPORT_CMD" | tail -20
  ok "已上傳。到 App Store Connect → TestFlight 看處理狀態，然後把 build 號、時間、來源 commit $GIT_SHA 記進 docs/STATUS.md"
else
  echo
  echo "沒有加 --upload，未上傳。要上傳請在自己的終端機跑："
  echo "  $EXPORT_CMD"
  echo "（Apple ID 階段過期回 DVTPortalServiceErrorDomain 1100 時，Xcode Settings → Apple Accounts 重新登入）"
fi
