#!/usr/bin/env bash
# 建置 Android App 殼：正式版 AAB（上傳 Google Play）＋同一份簽章的 APK（真機測試），或 debug APK。
# macOS 與 Linux 都能跑（不需要 Android Studio，要 JDK 21 與 Android SDK；見下方「環境」）。
#
# 用法（在 repo 根目錄、最新 main 的乾淨 checkout 或 worktree）：
#   scripts/archive-android.sh            正式版：npm run build → cap sync → 驗證 bundle → gradle bundleRelease assembleRelease
#                                         需要 android/keystore.properties（上傳金鑰；見下方「簽章」）
#   scripts/archive-android.sh --debug    debug APK（不用金鑰，裝到手機測試用；不能上傳 Play）
#
# 流程與檢查項目比照 scripts/archive-ios.sh（build 3／build 4 的教訓）：
#   - 不能有 .env.local（Vite 會拿它蓋過 .env，把本機 Supabase 網址打包進 App）
#   - bundle 裡必須有正式站 Supabase 網域與 Turnstile sitekey，不能有 127.0.0.1:54321
#   - worktree 用 symlink node_modules 時 cap sync 會把 capacitor.settings.gradle／Package.swift 的相對路徑改掉，要還原
#
# 環境：
#   - JDK 21：JAVA_HOME 沒設時依序試 macOS Homebrew openjdk@21、Linux /usr/lib/jvm/java-21-openjdk-amd64
#   - Android SDK：ANDROID_HOME 沒設時依序試 ~/Library/Android/sdk（macOS）、~/Android/Sdk（Linux）、/usr/local/lib/android/sdk（GitHub runner）
#     沒有 SDK 時用 command line tools 裝最小集合（platform-tools、platforms;android-36、build-tools;36.0.0），指令見本檔 need_sdk()
#   - Gradle 用 repo 內的 android/gradlew（8.14.3），缺少的 SDK 元件 AGP 會自己補下載（licenses 要先接受）
#
# 簽章（只做一次）：
#   keytool -genkeypair -v -keystore android/upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
#   然後寫 android/keystore.properties（已 gitignore）：
#     storeFile=upload.jks            # 相對 android/，或絕對路徑
#     storePassword=…
#     keyAlias=upload
#     keyPassword=…
#   這把是「上傳金鑰」：Play Console 建 App 時選 Google Play App Signing，Google 另外持有正式簽章金鑰；
#   上傳金鑰遺失可向 Google 申請重設，但金鑰與密碼要離線備份、絕不 commit。
#
# 版號：versionCode 預設取 git rev-list --count HEAD（main 每個 commit 都變大，Play 要求每次上傳遞增），
#   所以正式版只從 main 建（分支的 commit 數會跟 main 撞號或倒退）；要從別處建請自己指定 ANDROID_VERSION_CODE（大於 Play 上一次的值）。
#   versionName 預設 1.0（對齊 iOS MARKETING_VERSION），可用 ANDROID_VERSION_NAME 覆蓋。上傳後把 versionCode 與來源 commit 記進 docs/STATUS.md。
set -euo pipefail

MODE=release
for arg in "$@"; do
  case "$arg" in
    --debug) MODE=debug ;;
    -h|--help) sed -n 2,33p "$0"; exit 0 ;;
    *) echo "未知參數：$arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROD_SUPABASE_HOST=hvecvwzpummmlsakxqbw.supabase.co
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="android/output/$STAMP"   # android/.gitignore 已排除 output/

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

need_sdk() {
  cat >&2 <<'EOS'
找不到 Android SDK。設 ANDROID_HOME，或用 command line tools 裝最小集合（約 300 MB）：
  SDK=$HOME/android-sdk; mkdir -p "$SDK/cmdline-tools" && cd /tmp
  curl -L -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip   # macOS 把 linux 換成 mac
  unzip -q cmdline-tools.zip && mv cmdline-tools "$SDK/cmdline-tools/latest"
  yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses
  "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  export ANDROID_HOME="$SDK"
EOS
  exit 1
}

# ---- 環境 -----------------------------------------------------------------
command -v npm >/dev/null || fail "找不到 npm"
command -v git >/dev/null || fail "找不到 git"

if [ -z "${JAVA_HOME:-}" ]; then
  for cand in /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/java-21-openjdk; do
    if [ -x "$cand/bin/java" ]; then export JAVA_HOME="$cand"; break; fi
  done
fi
[ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] || fail "找不到 JDK 21：設 JAVA_HOME（macOS：brew install openjdk@21）"
JAVA_MAJOR="$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "$JAVA_MAJOR" = 21 ] || fail "JAVA_HOME 指到的不是 JDK 21（是 $JAVA_MAJOR）；AGP 8.13 要 JDK 17+，專案統一用 21"
ok "JDK 21：$JAVA_HOME"

if [ -z "${ANDROID_HOME:-}" ]; then
  for cand in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /usr/local/lib/android/sdk "$HOME/android-sdk"; do
    if [ -d "$cand/platform-tools" ] || [ -d "$cand/cmdline-tools" ]; then export ANDROID_HOME="$cand"; break; fi
  done
fi
[ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || need_sdk
ok "Android SDK：$ANDROID_HOME"

# ---- 前置檢查 -------------------------------------------------------------
[ ! -e .env.local ] || fail "有 .env.local，會蓋過 .env 把本機網址打包進 App。請在沒有 .env.local 的 worktree 建置（見 CLAUDE.md）"
[ -f .env ] || fail "缺 .env（正式站 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY／VITE_TURNSTILE_SITEKEY）"
grep -q "VITE_SUPABASE_URL=https://$PROD_SUPABASE_HOST" .env || fail ".env 的 VITE_SUPABASE_URL 不是正式站 $PROD_SUPABASE_HOST"
SITEKEY="$(sed -n 's/^VITE_TURNSTILE_SITEKEY=//p' .env | tr -d '"\r')"
[ -n "$SITEKEY" ] || fail ".env 缺 VITE_TURNSTILE_SITEKEY（正式值只在 GitHub secret，主 checkout 的 .env 沒有；公開值，從正式站 bundle 或 Cloudflare → Turnstile 拿，echo VITE_TURNSTILE_SITEKEY=<值> >> .env）"
ok "環境變數：正式站 Supabase、Turnstile sitekey ${SITEKEY:0:6}…"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "工作樹有未提交的變更，請先 commit 或 stash，建置要對得上一個 commit"
fi
GIT_SHA="$(git rev-parse --short HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$MODE" = release ] && [ -z "${ANDROID_VERSION_CODE:-}" ] && [ "$GIT_BRANCH" != main ]; then
  fail "正式版只從 main 建：versionCode 取 commit 數，分支會跟 main 撞號或倒退，Play 會拒收。要從分支建請設 ANDROID_VERSION_CODE=<大於 Play 上一次的值>"
fi
export ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-$(git rev-list --count HEAD)}"
export ANDROID_VERSION_NAME="${ANDROID_VERSION_NAME:-1.0}"
ok "建置來源：$GIT_BRANCH $GIT_SHA；versionCode $ANDROID_VERSION_CODE、versionName $ANDROID_VERSION_NAME"

if [ "$MODE" = release ]; then
  if [ -z "${ANDROID_KEYSTORE_FILE:-}" ] && [ ! -f android/keystore.properties ]; then
    fail "正式版需要簽章：缺 android/keystore.properties（或 ANDROID_KEYSTORE_FILE 等環境變數）。產生方式見本檔開頭「簽章」；只做手機測試請加 --debug"
  fi
  if [ -z "${ANDROID_KEYSTORE_FILE:-}" ]; then
    KS_REL="$(sed -n 's/^storeFile=//p' android/keystore.properties | tr -d '"\r')"
    case "$KS_REL" in /*) KS_PATH="$KS_REL" ;; *) KS_PATH="android/$KS_REL" ;; esac
    [ -f "$KS_PATH" ] || fail "keystore.properties 的 storeFile 指到不存在的檔案：$KS_PATH"
    # git check-ignore -q 一次只收一個路徑；repo 外的檔案不可能被 commit，不用查（git 對 repo 外的路徑會直接 fatal）。
    # 先把路徑化成實體絕對路徑再分類：storeFile=../../keys/upload.jks 這種用 .. 走出 repo 的相對路徑才不會被誤判成「在 repo 內」
    git check-ignore -q -- android/keystore.properties || fail "android/keystore.properties 沒被 gitignore，會進公開 repo"
    KS_ABS="$(cd "$(dirname "$KS_PATH")" && pwd -P)/$(basename "$KS_PATH")"
    case "$KS_ABS" in
      "$(pwd -P)"/*) git check-ignore -q -- "$KS_ABS" || fail "金鑰沒被 gitignore，會進公開 repo：$KS_ABS" ;;
      *) ok "金鑰在 repo 外：$KS_ABS" ;;
    esac
  fi
  ok "簽章設定存在"
fi

# ---- 建置網頁、同步原生專案 ---------------------------------------------
npm run build
npx cap sync android

# symlink node_modules 的 worktree：cap sync 會把路徑解析到 worktree 外，還原成版控裡的相對路徑
if ! git diff --quiet -- android/capacitor.settings.gradle ios/App/CapApp-SPM/Package.swift; then
  git checkout -- android/capacitor.settings.gradle ios/App/CapApp-SPM/Package.swift
  ok "cap sync 改寫了 capacitor.settings.gradle／Package.swift 的路徑，已還原"
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "cap sync 之後原生專案有漂移，請先檢查 git diff 並提交"

# ---- 驗證打包進 App 的網頁資源 -------------------------------------------
ASSETS=android/app/src/main/assets/public/assets
[ -d "$ASSETS" ] || fail "找不到 $ASSETS，cap sync 沒有複製網頁資源"
if grep -l "127\.0\.0\.1:54321" "$ASSETS"/*.js >/dev/null 2>&1; then
  fail "bundle 內嵌本機 Supabase 網址 127.0.0.1:54321，不能上傳"
fi
grep -l "$PROD_SUPABASE_HOST" "$ASSETS"/*.js >/dev/null || fail "bundle 沒有正式站 Supabase 網域"
grep -l "$SITEKEY" "$ASSETS"/*.js >/dev/null || fail "bundle 沒有 Turnstile sitekey"
grep -q 'com.capacitorjs.plugins.camera.CameraPlugin' android/app/src/main/assets/capacitor.plugins.json || fail "capacitor.plugins.json 沒有 camera 外掛"
# WebView 版本底線與錯誤頁（capacitor.config.ts android.minWebViewVersion／server.errorPath）要有同步進 App，否則舊 WebView 白屏沒訊息
grep -q '"minWebViewVersion"' android/app/src/main/assets/capacitor.config.json || fail "capacitor.config.json 沒有 minWebViewVersion"
grep -q '"errorPath"' android/app/src/main/assets/capacitor.config.json || fail "capacitor.config.json 沒有 errorPath"
[ -f android/app/src/main/assets/public/webview-outdated.html ] || fail "App 內沒有 webview-outdated.html（public/ 沒進 dist？）"
MINWV="$(sed -n 's/.*"minWebViewVersion": *\([0-9][0-9]*\).*/\1/p' android/app/src/main/assets/capacitor.config.json)"
grep -q "var MIN = $MINWV;" android/app/src/main/assets/public/webview-outdated.html || fail "webview-outdated.html 的 MIN 與 capacitor.config 的 minWebViewVersion（$MINWV）不同步"
ok "bundle 驗證：只有正式站網域、有 sitekey、無本機位址；外掛清單含 camera；WebView 底線（$MINWV）與錯誤頁都在且一致"

# ---- Gradle ---------------------------------------------------------------
mkdir -p "$OUT"
printf '%s %s versionCode=%s versionName=%s\n' "$GIT_BRANCH" "$GIT_SHA" "$ANDROID_VERSION_CODE" "$ANDROID_VERSION_NAME" > "$OUT/source-commit.txt"
chmod +x android/gradlew
# 清掉上次的產物：Gradle 失敗時下面的「檔案存在」檢查才不會拿舊檔冒充這次
rm -rf android/app/build/outputs/apk android/app/build/outputs/bundle
GRADLE_LOG="$OUT/gradle.log"
run_gradle() {
  echo "▶ gradle $*（完整紀錄 $GRADLE_LOG）"
  if ! (cd android && ./gradlew --no-daemon "$@") > "$GRADLE_LOG" 2>&1; then
    # 摘要放在 if 條件裡：沒有任何一行符合（例如離線時 gradle wrapper 下載失敗、daemon 被 OOM 殺掉）時 grep 回 1，
    # 放在外面會被 set -e 直接結束、連下面的 fail 都印不出來；這時改印最後 20 行
    if ! grep -E -A3 "error:|FAILURE|What went wrong" "$GRADLE_LOG" | head -40 >&2; then tail -20 "$GRADLE_LOG" >&2; fi
    fail "gradle $* 失敗，完整紀錄：$GRADLE_LOG"
  fi
  grep -E "BUILD|warning:" "$GRADLE_LOG" || true
}
if [ "$MODE" = debug ]; then
  run_gradle assembleDebug
  APK=android/app/build/outputs/apk/debug/app-debug.apk
  [ -f "$APK" ] || fail "debug APK 沒有產生"
  cp "$APK" "$OUT/goodmarket-debug.apk"
  ok "debug APK：$OUT/goodmarket-debug.apk（adb install -r 或傳到手機安裝；未簽正式金鑰，不能上傳 Play）"
else
  run_gradle bundleRelease assembleRelease
  AAB=android/app/build/outputs/bundle/release/app-release.aab
  APK=android/app/build/outputs/apk/release/app-release.apk
  [ -f "$AAB" ] || fail "release AAB 沒有產生"
  [ -f "$APK" ] || fail "release APK 沒有產生"
  cp "$AAB" "$OUT/goodmarket-release.aab"
  cp "$APK" "$OUT/goodmarket-release.apk"
  # AAB 的簽章用 JDK 的 jarsigner 驗（AAB 是 jar 簽章，apksigner 不收）
  "$JAVA_HOME/bin/jarsigner" -verify "$AAB" | grep -q "jar verified" || fail "release AAB 簽章驗證失敗"
  # APK 簽章與 manifest 驗證：build-tools 的 apksigner／aapt2（AGP 會補下載，版本取現有最新）。
  # ls 沒有符合的目錄會回非 0，要 || true 否則 set -e 會在這裡悄悄結束（Gradle 可能用 android/local.properties 的 sdk.dir，不是這個 ANDROID_HOME）
  BT="$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$BT" ] && [ -x "$BT/apksigner" ]; then
    "$BT/apksigner" verify --print-certs "$APK" | grep -E "Signer #1 certificate DN|Verifies" || fail "release APK 簽章驗證失敗"
    # uses-permission 預期四行：INTERNET、ACCESS_NETWORK_STATE、VIBRATE，加 androidx.core 自動加的 App 私有 DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
    "$BT/aapt2" dump badging "$APK" | grep -E "^package:|targetSdkVersion|uses-permission" || true
    # Play 2027-02-01 起更新必須支援 16 KB 記憶體分頁：camera 外掛帶進 CameraX 的 .so，要對齊 16 KB
    "$BT/zipalign" -c -P 16 -v 4 "$APK" | tail -1 | grep -q "Verification succes" || fail "release APK 的原生程式庫沒有 16 KB 對齊（Play 2027-02-01 起拒收更新）"
    ok "AAB／APK 簽章、manifest、16 KB 對齊都驗過"
  else
    echo "⚠ $ANDROID_HOME 下沒有 build-tools，略過 APK 簽章／16 KB 對齊驗證（AAB 簽章已驗）；上傳前請用 apksigner／zipalign 補驗" >&2
  fi
  ok "release AAB：$OUT/goodmarket-release.aab（上傳 Play Console）；同簽章 APK：$OUT/goodmarket-release.apk（真機測試）"
fi

echo
echo "來源：$(cat "$OUT/source-commit.txt")"
echo "上傳 Play 後把 versionCode、時間、來源 commit 記進 docs/STATUS.md。"
