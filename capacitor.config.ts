/// <reference types="@capacitor/status-bar" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.nightzhe.goodmarket',
  appName: '好物集',
  webDir: 'dist',
  server: {
    // WebView 的 hostname 用正式站網域：Cloudflare Turnstile 只在允許清單上的 hostname 載入（預設 localhost 會回 110200 Domain not allowed），
    // 手機簡訊登入與審查員登入的安全驗證才過得了。iOS 來源會是 capacitor://nightzhe.github.io，Android 是 https://nightzhe.github.io（本機資產，不是真的連線上）。
    hostname: 'nightzhe.github.io',
    // 載入失敗時顯示的靜態頁（public/，隨 npm run build 進 dist 與 App）：Android 的 WebView 版本低於 minWebViewVersion 時由 Capacitor 導到這裡；
    // iOS 是網頁載入失敗時。只能是純 HTML＋ES5，Capacitor 說明這一頁拿不到外掛。
    errorPath: 'webview-outdated.html',
  },
  android: {
    // 網頁 bundle 的底線：Vite 8 預設 target chrome111（baseline widely available）＝Tailwind 4 的底線（color-mix、@layer、dvh）。
    // 低於這個版本的 Android System WebView 會白屏（SyntaxError）或整頁沒樣式，Capacitor 預設只擋到 60 且不顯示任何訊息；
    // 設了之後導到 server.errorPath 請使用者到 Play 更新 WebView（Android 7 可更新到 119、8／9 到 138，都 ≥ 111）。
    // Vite 或 Tailwind 升大版時重查 dist 的語法底線再調這個數字（scripts/archive-android.sh 與 CI 會檢查設定有同步進 App）。
    minWebViewVersion: 111,
  },
  plugins: {
    // 狀態列文字深色（D-7d）。Capacitor 的命名：LIGHT＝淺色背景配深色文字。App 只有白底，iOS／Android 都適用；
    // overlaysWebView 維持預設 true（安全區由網頁自己處理；Android 15+ 本來就只能 overlay）。
    StatusBar: { style: 'LIGHT' },
    // Android 專用（iOS 忽略）：Capacitor 8 內建的 SystemBars 會在 StatusBar 之後非同步套用自己的 DEFAULT 樣式（跟著系統深淺色），
    // 系統深色模式時手勢列／三鍵列會變白色圖示壓在白底 App 上；這裡固定 LIGHT（深色圖示）兩條列都對。
    // initialViewportFitValueHint 對齊 index.html 的 viewport-fit=cover，避免第一幀先留白再重排。
    SystemBars: { style: 'LIGHT', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
