import type { SellerTab } from './types';

// ───────── 買家端的篩選（元件狀態，不寫網址） ─────────

export interface BuyerFilter { rating: number | null; photos: boolean }

export const NO_FILTER: BuyerFilter = { rating: null, photos: false };

export const isFiltering = (f: BuyerFilter) => f.rating !== null || f.photos;

/** 星等單選，再點一次取消；「附照片」是獨立開關，可以跟星等同時選 */
export const toggleRating = (f: BuyerFilter, n: number): BuyerFilter => ({ ...f, rating: f.rating === n ? null : n });
export const togglePhotos = (f: BuyerFilter): BuyerFilter => ({ ...f, photos: !f.photos });

// ───────── 賣家評價管理的網址狀態 ─────────

export interface SellerState { tab: SellerTab; rating: number | null }

const KEYS = ['tab', 'rating'] as const;

export const parseSellerTab = (raw: string | null): SellerTab => (raw === 'unreplied' ? 'unreplied' : 'all');

/** 只接受 1–5 的整數寫法；"0"、"6"、"3.5"、"03"、"abc" 都退回「全部」 */
export const parseRatingParam = (raw: string | null): number | null =>
  raw !== null && /^[1-5]$/.test(raw) ? Number(raw) : null;

export const readSellerState = (p: URLSearchParams): SellerState => ({
  tab: parseSellerTab(p.get('tab')),
  rating: parseRatingParam(p.get('rating')),
});

/** 預設值（全部／全部）不寫進網址；其餘參數（例如別的功能的）原樣保留 */
export function writeSellerState(base: URLSearchParams, s: SellerState): URLSearchParams {
  const next = new URLSearchParams(base);
  if (s.tab === 'all') next.delete('tab'); else next.set('tab', s.tab);
  if (s.rating === null) next.delete('rating'); else next.set('rating', String(s.rating));
  return next;
}

/** 網址上有不合法或多餘的值時，要把網址改成實際顯示的狀態 */
export const needsNormalize = (p: URLSearchParams): boolean => {
  const next = writeSellerState(p, readSellerState(p));
  return KEYS.some(k => next.get(k) !== p.get(k));
};

// ───────── 評價總覽：這件商品屬於哪家店 ─────────

/**
 * 「賣場評價」分頁要知道店 id。優先用商品目前的資料；商品下架或刪除後，匿名讀不到 products，
 * 就改用評價快照裡的 shop_id（資料庫在 get_product_reviews 的 product 一併回傳）。
 * 兩邊都沒有（商品不存在、也沒有任何評價）才回 null，這時不顯示分頁。
 */
export const resolveShopId = (
  current: { shopId: string } | undefined | null,
  snapshot: { shop_id: string } | undefined | null,
): string | null => current?.shopId ?? snapshot?.shop_id ?? null;
