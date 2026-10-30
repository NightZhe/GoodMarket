import { App } from '@capacitor/app';
import { nativePlatform } from './platform';
import { initNativeAuth } from './auth';
import { initNativeDeepLinks } from './deeplink';
import { NATIVE_BACK_EVENT } from './callback';
import { refreshPosture, startPosture } from '../layout/posture';
import { SELLER_LAYOUT_MARK, needsShellInset } from './shellInset';

// 原生殼的啟動：只在 App 內由 main.tsx 動態載入（網頁 bundle 不含這些外掛）。
//   - <html> 加 class native／native-ios／native-android，殼專用樣式（native.css，由 main.tsx 靜態載入）靠它生效
//   - 側邊姿態判定（data-bars）：載入、旋轉、回前景都重判（lib/layout/posture.ts）
//   - 狀態列文字深色（白底 App）
//   - Android 實體返回鍵：先問畫面（登入面板開著就只關面板），再來 hash 路由能回就回，回到底就離開 App
//   - 登入回跳與瀏覽器視圖的監聽；一般深連結（審查員登入頁 ://review-login）

export async function initNativeShell(): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  // 側邊姿態判定（<html data-bars>，iPhone Duo 適配）：先判一次，resize／旋轉／顯示狀態改變由 posture.ts 自己監聽；從背景回來（resume）在下面補判
  startPosture();
  // 狀態列文字顏色（D-7d）：App 只有白底，時間／電量要深色。capacitor.config.ts 的 plugins.StatusBar.style 讓第一幀就對，
  // 這裡再設一次是保險。Capacitor 的命名：Style.Light＝淺色背景配深色文字（不是淺色文字）。
  void import('@capacitor/status-bar').then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light })).catch(() => { /* 外掛不在就算了 */ });
  await initNativeAuth();
  await initNativeDeepLinks();
  // 狀態列安全區：買家前台（安全區色帶＋sticky top-[env(...)] 頂欄）與賣家中心（SellerLayout 自己的安全區色帶與懸浮控制列）都自己處理，殼不插手；
  // 殼只補沒有賣家外框（SellerLayout 掛 data-seller-layout）的賣家頁（賣家登入頁、開店表單）：把 body 往下推。
  // 用 MutationObserver 看 DOM（路由切換是 pushState，不會發 hashchange）；不用 CSS :has()（WKWebView 上實測沒有命中，原因未查明）。
  const syncStickyClass = () => {
    const needsInset = needsShellInset(window.location.hash, document.querySelector(`[${SELLER_LAYOUT_MARK}]`) !== null);
    document.documentElement.classList.toggle('native-no-sticky', needsInset);
  };
  new MutationObserver(syncStickyClass).observe(document.body, { childList: true, subtree: true });
  syncStickyClass();
  await App.addListener('resume', refreshPosture);
  await App.addListener('backButton', ({ canGoBack }) => {
    const consumed = !window.dispatchEvent(new CustomEvent(NATIVE_BACK_EVENT, { cancelable: true }));
    if (consumed) return;
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
