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
};

export default config;
