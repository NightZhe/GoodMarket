/** 買家前台依路徑決定的頁首樣式（App Store 風，design-final §4.1）。純函式，方便測試 */
export type HeaderKind =
  /** 分頁根頁：大標題跟內容一起捲走 */
  | { kind: 'large'; title: string; cart: boolean; search: boolean }
  /** 第二層頁：44pt 導覽列，左「‹ 上一頁名稱」。shareProductId 有值時右側多一顆分享 */
  | { kind: 'nav'; back: { to: string; label: string }; cart: boolean; shareProductId: string | null }
  /** 帳號子頁：頁面自己有導覽列，外框只放安全區條 */
  | { kind: 'plain' };

const HOME = { to: '/', label: '首頁' };
const ORDERS = { to: '/orders', label: '訂單' };

const nav = (back: { to: string; label: string }, cart = true, shareProductId: string | null = null): HeaderKind =>
  ({ kind: 'nav', back, cart, shareProductId });

export function headerFor(pathname: string): HeaderKind {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'large', title: '好物集', cart: true, search: true };
  if (path === '/search') return { kind: 'large', title: '逛逛', cart: true, search: true };
  if (path === '/orders') return { kind: 'large', title: '訂單', cart: false, search: false };
  if (path === '/account') return { kind: 'large', title: '我的', cart: false, search: false };

  const product = /^\/product\/([^/]+)$/.exec(path);
  if (product) return nav(HOME, true, product[1]);
  const reviews = /^\/product\/([^/]+)\/reviews$/.exec(path);
  if (reviews) return nav({ to: `/product/${reviews[1]}`, label: '商品' });

  // 購物車頁的購物車鈕只會指向自己，不放
  if (path === '/cart') return nav(HOME, false);
  if (path === '/checkout') return nav({ to: '/cart', label: '購物車' });
  if (path === '/privacy' || path.startsWith('/shop/')) return nav(HOME);
  if (/^\/orders\/[^/]+\/review$/.test(path) || path.startsWith('/pay/')) return nav(ORDERS);

  return { kind: 'plain' };
}
