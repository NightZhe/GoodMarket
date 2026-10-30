// 賣家中心導覽的純邏輯（無畫面）：哪些頁隱藏導覽、哪些頁底部有儲存托盤、5 個分頁各自的導覽目標。
// 只有 SellerLayout 用（hidesNav／hasSaveTray／isChatThreadPath／sellerTabRoutes）；圖示與版面留在元件裡。

import { SELLER_CHAT_LIST_PATH } from '../../lib/chat/sellerPaths';

export type SellerTabKey = 'overview' | 'chat' | 'products' | 'new' | 'orders';

/** 分頁的真實目的地（順序固定 5 格：總覽／聊聊／商品／新增／訂單，聊聊 N2＝A 使用者定版；物流設定與評價管理從賣場總覽進，決策 N4＝B） */
const TABS: { key: SellerTabKey; to: string }[] = [
  { key: 'overview', to: '/seller' },
  { key: 'chat', to: SELLER_CHAT_LIST_PATH },
  { key: 'products', to: '/seller/products' },
  { key: 'new', to: '/seller/products/new' },
  { key: 'orders', to: '/seller/orders' },
];

/** 賣家聊聊的對話頁（含從訂單進的 /seller/chat/new）：有輸入列與鍵盤，手機版整頁都是對話 */
export const isChatThreadPath = (pathname: string): boolean => /^\/seller\/chat\/[^/]+/.test(pathname);

/**
 * 物流店到店與地址表單頁、新增銀行帳號與簡訊驗證頁、聊聊對話頁會跳出鍵盤，固定在底部的導覽在 iOS 鍵盤開關時會跳，所以這幾頁不顯示分頁導覽（含直立軌，AC-25）
 */
export const hidesNav = (pathname: string): boolean =>
  /^\/seller\/logistics\/(stores|address)(\/|$)/.test(pathname) || /^\/seller\/payout\/bank-accounts\/(new|verify)/.test(pathname) || isChatThreadPath(pathname);

/** 新增與編輯商品：底部有懸浮儲存托盤（內容底部要為它預留空間）。匯入精靈（/products/import）不算 */
export const hasSaveTray = (pathname: string): boolean => /^\/seller\/products\/(new|[^/]+\/edit)$/.test(pathname);

/** 不在自己分頁路徑上、但屬於某分頁的流程：匯入精靈屬「我的商品」，物流設定、銀行帳號與評價管理屬「賣場總覽」，聊聊對話屬「聊聊」 */
function proxyTab(pathname: string): SellerTabKey | null {
  if (pathname.startsWith('/seller/products/import')) return 'products';
  if (pathname.startsWith('/seller/logistics') || pathname.startsWith('/seller/payout') || pathname.startsWith('/seller/reviews')) return 'overview';
  if (isChatThreadPath(pathname)) return 'chat';
  return null;
}

export type SellerTabRoute = {
  key: SellerTabKey;
  /** 交給 NavLink 的路徑（決定誰被選中）。代選中的分頁換成目前路徑，其餘就是 goTo */
  to: string;
  /** 點下去真正要去的地方。與 to 不同時，呼叫端要用 onReselect 導過去 */
  goTo: string;
};

/**
 * 5 個分頁的導覽目標。共用元件的選中態來自 NavLink（只比對 to），沒有「自訂選中」的出口，
 * 所以匯入精靈、物流設定、評價管理與聊聊對話頁讓代選中的那一格把 to 換成目前路徑（NavLink 就認為它在這頁），再用 goTo 補回真正的目的地。
 */
export function sellerTabRoutes(pathname: string): SellerTabRoute[] {
  const proxy = proxyTab(pathname);
  return TABS.map(t => ({ key: t.key, to: t.key === proxy ? pathname : t.to, goTo: t.to }));
}

/**
 * 自己有 SubHeader「‹ 上一層」返回的賣家頁（物流兩張表單、收款帳戶）。頂部懸浮的「‹ 首頁」在這幾頁不出現（C2＝a），
 * 否則同畫面兩個返回；右上四顆照常。日後新增有 SubHeader 的賣家頁要加進來。
 */
export const hasOwnBackHeader = (pathname: string): boolean =>
  /^\/seller\/logistics\/(stores|address)(\/|$)/.test(pathname) || /^\/seller\/payout\/?$/.test(pathname);

/** 左上「‹ 首頁」要不要出現：側邊姿態（直立軌已有「回到買家首頁」，X5）與自己有返回的頁都不出現 */
export const showsHomeButton = (pathname: string, posture: 'bottom' | 'side-left' | 'side-right'): boolean =>
  posture === 'bottom' && !hasOwnBackHeader(pathname);

/**
 * 有 SubHeader 的三頁，頂部怎麼排（design.md U-8，使用者尚未回覆，照小u 預設 A）：
 *   'band'：A（現況）。bandTall 為 true：SellerLayout 把 --seller-band-h 設成「安全區＋52」、色帶改灰，main 在手機 pt-0，
 *            index.css 檔尾的 `html body [data-seller-layout] header…` 規則讓 SubHeader 黏在 --seller-band-h 下。右群組照常（forceCollapse 為 false）。
 *   'collapse'：B（沒實作完）。目前切成 B 只會有這兩個效果：bandTall 變 false（色帶回一般高度、main 回 pt-15）、SellerLayout 傳 forceCollapse（右上收成「⋯」）。
 *            還缺：(1) 這三頁的 SubHeader 要加高到 52 並垂直對齊「⋯」（範圍 CSS，不改 components/account/ui.tsx）；
 *            (2) main 的 pt-15 會把 SubHeader 往下推 60，這三頁要改成 pt-0 並讓 SubHeader 黏頂位置回到安全區（現在 index.css 規則讀 --seller-band-h，B 下該變數是一般色帶高度，可沿用）；
 *            (3) 刪掉或改寫 index.css 檔尾說明 A 的註解、並重新跑 AC-H15 截圖。
 */
export const SUB_HEADER_LAYOUT: 'band' | 'collapse' = 'band';

/** 左鈕寬度（含「‹」與間距）固定的部分：左內距 6＋「‹」24＋右內距 14 */
export const HOME_BUTTON_CHROME = 44;
const HOME_GAP = 8;
const MORE_BUTTON = 44;

/**
 * 左鈕連「⋯」都放不下（列寬 < 左鈕全寬＋間距＋44）才縮成只有「‹」的 44 圓鈕（保險條款：朗讀名稱不變）。
 * 量不到（Infinity）時不縮。
 */
export const homeButtonCompact = (rowWidth: number, homeFullWidth: number): boolean =>
  rowWidth < homeFullWidth + HOME_GAP + MORE_BUTTON;

/** SubPage 自己有左右 16 內距的賣家子頁（收款帳戶）：SubHeader 的 -mx-4 抵掉的是它自己的內距，main 在手機就不能再留 12，否則灰色色帶兩側會露出白縫。物流兩張表單沒有 SubPage 外層，維持原樣 */
export const subPageOwnsPadding = (pathname: string): boolean => /^\/seller\/payout\/?$/.test(pathname);
