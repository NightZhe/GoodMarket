// 賣家中心導覽的純邏輯（無畫面）：哪些頁隱藏導覽、哪些頁底部有儲存托盤、5 個分頁各自的導覽目標。
// 只有 SellerLayout 用（hidesNav／hasSaveTray／sellerTabRoutes）；圖示與版面留在元件裡。

export type SellerTabKey = 'overview' | 'products' | 'new' | 'orders' | 'reviews';

/** 分頁的真實目的地（順序固定 5 格；物流設定從賣場總覽進，決策 N4＝B） */
const TABS: { key: SellerTabKey; to: string }[] = [
  { key: 'overview', to: '/seller' },
  { key: 'products', to: '/seller/products' },
  { key: 'new', to: '/seller/products/new' },
  { key: 'orders', to: '/seller/orders' },
  { key: 'reviews', to: '/seller/reviews' },
];

/** 物流店到店與地址表單頁、新增銀行帳號與簡訊驗證頁會跳出鍵盤，固定在底部的導覽在 iOS 鍵盤開關時會跳，所以這幾頁不顯示分頁導覽（含直立軌，AC-25） */
export const hidesNav = (pathname: string): boolean =>
  /^\/seller\/logistics\/(stores|address)(\/|$)/.test(pathname) || /^\/seller\/payout\/bank-accounts\/(new|verify)/.test(pathname);

/** 新增與編輯商品：底部有懸浮儲存托盤（內容底部要為它預留空間）。匯入精靈（/products/import）不算 */
export const hasSaveTray = (pathname: string): boolean => /^\/seller\/products\/(new|[^/]+\/edit)$/.test(pathname);

/** 不在自己分頁路徑上、但屬於某分頁的流程：匯入精靈屬「我的商品」，物流設定與銀行帳號屬「賣場總覽」 */
function proxyTab(pathname: string): SellerTabKey | null {
  if (pathname.startsWith('/seller/products/import')) return 'products';
  if (pathname.startsWith('/seller/logistics') || pathname.startsWith('/seller/payout')) return 'overview';
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
 * 所以匯入精靈與物流設定頁讓代選中的那一格把 to 換成目前路徑（NavLink 就認為它在這頁），再用 goTo 補回真正的目的地。
 */
export function sellerTabRoutes(pathname: string): SellerTabRoute[] {
  const proxy = proxyTab(pathname);
  return TABS.map(t => ({ key: t.key, to: t.key === proxy ? pathname : t.to, goTo: t.to }));
}
