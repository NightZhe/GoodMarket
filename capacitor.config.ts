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
    // 載入失敗時顯示的靜態頁（public/，隨 npm run build 進 dist 與 App）。Capacitor Android 兩種情況會導到這裡：WebView 版本低於 minWebViewVersion
    // （Bridge.loadWebView），以及主框架載入／HTTP 錯誤（BridgeWebViewClient.onReceivedError／onReceivedHttpError，目前 App 內沒有會觸發的主框架導航）；
    // iOS 是網頁載入失敗時。頁面自己用 UA 的 Chrome 版本分辨是哪一種。只能是純 HTML＋ES5，Capacitor 說明這一頁拿不到外掛。
    errorPath: 'webview-outdated.html',
  },
  android: {
    // 網頁 bundle 的底線：Vite 8 預設 target chrome111（baseline widely available）＝Tailwind 4 的底線（color-mix、@layer、dvh）。
    // 低於這個版本的 Android System WebView 會白屏（SyntaxError）或整頁沒樣式，Capacitor 預設只擋到 60 且不顯示任何訊息；
    // 設了之後導到 server.errorPath 請使用者到 Play 更新 WebView（Android 7 可更新到 119、8／9 到 138，都 ≥ 111）。
    // 注意 Capacitor 在 API 24～25（Android 7）不用 WebView.getCurrentWebViewPackage()，而是查 com.android.chrome 的版本：
    // Chrome 被停用（退回出廠版）時會誤判太舊而擋下，錯誤頁有寫「啟用並更新 Chrome」；要徹底避免只能把 minSdk 提到 26（docs/STATUS.md 待決 (c)）。
    // Vite 或 Tailwind 升大版時重查 dist 的語法底線再調這個數字，並同步 public/webview-outdated.html 的 MIN
    // （scripts/archive-android.sh 與 CI 會檢查設定有同步進 App、兩邊數字一致）。
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
