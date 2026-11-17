import { App } from '@capacitor/app';
import { nativePlatform } from './platform';
import { handleNativeAuthUrl, initNativeAuth } from './auth';
import { openNativeRoute } from './deeplink';
import { NATIVE_BACK_EVENT } from './callback';
import { consumeNativeBack } from './backStack';
import { refreshPosture, startPosture } from '../layout/posture';
import { SELLER_LAYOUT_MARK, needsShellInset } from './shellInset';

// 原生殼的啟動：只在 App 內由 main.tsx 動態載入（網頁 bundle 不含這些外掛）。
//   - <html> 加 class native／native-ios／native-android，殼專用樣式（native.css，由 main.tsx 靜態載入）靠它生效
//   - 側邊姿態判定（data-bars）：載入、旋轉、回前景都重判（lib/layout/posture.ts）
//   - 狀態列文字深色（白底 App）
//   - Android 實體返回鍵：先問開著的覆蓋層（backStack：抽屜／對話框／浮層用 useNativeBack 登記，等同 Esc），再問畫面事件（登入面板），
//     再來 hash 路由能回就回，回到底就離開 App。監聽要在任何 await 之前登記，否則啟動頭幾百毫秒按返回鍵沒反應
//   - 深連結只登記一個 appUrlOpen 監聽，同一個網址同時交給登入回跳（auth.ts，只認 ://auth）與一般路由（deeplink.ts，審查員登入頁 ://review-login）：
//     Capacitor Android 把「監聽登記前就送到、暫存的」事件只交給第一個登記的監聽者，分開登記時 ://review-login 會被 auth.ts 吃掉。
//     冷啟動由網址喚起時事件可能已經送過，所以再查一次 getLaunchUrl（Android 回的是建立 Activity 的那個 intent、之後不會更新，只在啟動時查這一次）；
//     兩邊各自對同一個網址去重（auth 用 lastUrl＋localStorage 記已換過的 code：code 只能換一次，WebView 重載後 getLaunchUrl 會再給同一個網址；deeplink 看目前 hash）

export async function initNativeShell(): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  // 側邊姿態判定（<html data-bars>，iPhone Duo 適配）：先判一次，resize／旋轉／顯示狀態改變由 posture.ts 自己監聽；從背景回來（resume）在下面補判
  startPosture();
  // 狀態列文字顏色（D-7d）：App 只有白底，時間／電量要深色。capacitor.config.ts 的 plugins.StatusBar.style 讓第一幀就對，
  // 這裡再設一次是保險。Capacitor 的命名：Style.Light＝淺色背景配深色文字（不是淺色文字）。
  void import('@capacitor/status-bar').then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light })).catch(() => { /* 外掛不在就算了 */ });
  const onUrl = (url: string) => { void handleNativeAuthUrl(url); openNativeRoute(url); };
  await App.addListener('appUrlOpen', e => onUrl(e.url));
  await App.addListener('resume', refreshPosture);
  await App.addListener('backButton', ({ canGoBack }) => {
    if (consumeNativeBack()) return;
    const consumed = !window.dispatchEvent(new CustomEvent(NATIVE_BACK_EVENT, { cancelable: true }));
    if (consumed) return;
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  await initNativeAuth();
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) onUrl(launch.url);
  // 狀態列安全區：買家前台（安全區色帶＋sticky top-[env(...)] 頂欄）與賣家中心（SellerLayout 自己的安全區色帶與懸浮控制列）都自己處理，殼不插手；
  // 殼只補沒有賣家外框（SellerLayout 掛 data-seller-layout）的賣家頁（賣家登入頁、開店表單）：把 body 往下推。
  // 用 MutationObserver 看 DOM（路由切換是 pushState，不會發 hashchange）；不用 CSS :has()（WKWebView 上實測沒有命中，原因未查明）。
  const syncStickyClass = () => {
    const needsInset = needsShellInset(window.location.hash, document.querySelector(`[${SELLER_LAYOUT_MARK}]`) !== null);
    document.documentElement.classList.toggle('native-no-sticky', needsInset);
  };
  new MutationObserver(syncStickyClass).observe(document.body, { childList: true, subtree: true });
  syncStickyClass();
}
