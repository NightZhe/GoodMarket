/** 買家前台依路徑決定的頁首樣式（App Store 風，design-final §4.1）。純函式，方便測試 */
/** 導覽列右側分享鈕要分享的對象：商品頁、店家頁（D-7b） */
export type ShareTarget = { kind: 'product' | 'shop'; id: string };

export type HeaderKind =
  /** 分頁根頁：大標題跟內容一起捲走 */
  | { kind: 'large'; title: string; cart: boolean; search: boolean }
  /**
   * 第二層頁：44pt 導覽列，左「‹ 上一頁名稱」。share 有值時右側多一顆分享（商品頁、店家頁）。
   * 側邊姿態不顯示導覽列（返回、購物車、分享搬到直立軌）：title 是內容頂端的行內標題，只給頁面自己沒有可見標題的頁；null＝頁面自己有標題
   */
  | { kind: 'nav'; back: { to: string; label: string }; cart: boolean; share: ShareTarget | null; title: string | null }
  /** 帳號子頁：頁面自己有導覽列，外框只放安全區條 */
  | { kind: 'plain' };

const HOME = { to: '/', label: '首頁' };
const ORDERS = { to: '/orders', label: '訂單' };

const nav = (
  back: { to: string; label: string },
  { cart = true, share = null, title = null }: { cart?: boolean; share?: ShareTarget | null; title?: string | null } = {},
): HeaderKind => ({ kind: 'nav', back, cart, share, title });

export function headerFor(pathname: string): HeaderKind {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'large', title: '好物集', cart: true, search: true };
  if (path === '/search') return { kind: 'large', title: '逛逛', cart: true, search: true };
  if (path === '/orders') return { kind: 'large', title: '訂單', cart: false, search: false };
  if (path === '/account') return { kind: 'large', title: '我的', cart: false, search: false };

  const product = /^\/product\/([^/]+)$/.exec(path);
  if (product) return nav(HOME, { share: { kind: 'product', id: product[1] } });
  const reviews = /^\/product\/([^/]+)\/reviews$/.exec(path);
  if (reviews) return nav({ to: `/product/${reviews[1]}`, label: '商品' });

  // 購物車頁的購物車鈕只會指向自己，不放
  if (path === '/cart') return nav(HOME, { cart: false, title: '購物車' });
  if (path === '/checkout') return nav({ to: '/cart', label: '購物車' }, { title: '結帳' });
  const shop = /^\/shop\/([^/]+)$/.exec(path);
  if (shop) return nav(HOME, { share: { kind: 'shop', id: shop[1] } });
  if (path === '/privacy' || path.startsWith('/shop/')) return nav(HOME);
  if (/^\/orders\/[^/]+\/review$/.test(path) || path.startsWith('/pay/')) return nav(ORDERS);

  return { kind: 'plain' };
}

/**
 * 側邊姿態沒有導覽列時，內容頂端的行內標題。頁面自己有可見 h1（結帳成功態、下單失敗、登入閘門）要先宣告（useOwnsPageTitle），
 * 這裡看到宣告就不出標題，同一頁永遠只有一個 h1。回 null＝不畫（畫一條 12pt 的留白由呼叫端處理）。
 */
export function inlineTitle(header: HeaderKind, pageOwnsTitle: boolean): string | null {
  return header.kind === 'nav' && !pageOwnsTitle ? header.title : null;
}
