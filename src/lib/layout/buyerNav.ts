import { isChatConversationPath } from '../chat/nav';

/**
 * 買家前台兩組主要分頁導覽的顯示規則（純函式，buyerNav.test.ts 釘住）。
 * 兩組同一時間只有一組在 DOM 中可見（AC-C8）：手機底部膠囊／Duo 直立軌（寬 < md 或 App 內）與桌機右側浮動軌（md 以上且非 App），
 * 切換靠 CSS 斷點（index.css 的 md 變體只在 html:not(.native) 生效），這裡只決定「這一頁該不該有」。
 */

/**
 * 手機底部膠囊（與 Duo 直立軌分頁組）要不要藏起來。
 * 商品頁、結帳頁有自己的底部操作列；評價表單底部有送出列；地址表單、綁卡、銀行流程有鍵盤（iOS Safari 鍵盤開關時 fixed 的膠囊會跳）；
 * 付款結果頁要專心看結果；聊聊對話頁有自己的輸入列（列表頁 /chat 仍顯示）。
 * 購物車成為分頁後（D6、D15）購物車頁顯示膠囊，結帳托盤疊在膠囊上（Cart.tsx 的 abovePill）。
 */
export function hideBuyerTabBar(pathname: string): boolean {
  return pathname.startsWith('/product/')
    || pathname === '/checkout'
    || /^\/orders\/[^/]+\/review$/.test(pathname)
    || pathname.startsWith('/account/addresses/')
    || pathname === '/account/payment-methods/new'
    || pathname === '/account/payment-methods/result'
    || pathname.startsWith('/account/bank-accounts/')
    || pathname.startsWith('/pay/')
    || isChatConversationPath(pathname);
}

/**
 * 桌機右側浮動軌（D13）：買家所有頁都顯示，只有結帳與付款流程頁（結帳、付款結果、綁卡、銀行流程）不顯示，讓人專心完成流程。
 * 商品頁、購物車頁、聊聊對話頁桌機照樣顯示。
 */
export function showBuyerRail(pathname: string): boolean {
  return !(
    pathname === '/checkout'
    || pathname.startsWith('/pay/')
    || pathname === '/account/payment-methods/new'
    || pathname === '/account/payment-methods/result'
    || pathname.startsWith('/account/bank-accounts/')
  );
}

/**
 * 內容底部要不要為膠囊預留 --tabs-clearance。購物車頁自己依「托盤疊在膠囊上」預留（--stack-clearance），外框不再多留一份。
 */
export function reserveForTabBar(pathname: string): boolean {
  return !hideBuyerTabBar(pathname) && pathname !== '/cart';
}
