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
  },
  plugins: {
    // 狀態列文字深色（D-7d）。Capacitor 的命名：LIGHT＝淺色背景配深色文字。App 只有白底，iOS／Android 都適用；
    // overlaysWebView 維持預設 true（安全區由網頁自己處理；Android 15+ 本來就只能 overlay）。
    StatusBar: { style: 'LIGHT' },
  },
};

export default config;
