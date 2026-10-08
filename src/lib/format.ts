export const money = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`;

export const soldText = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}萬` : n.toLocaleString('zh-TW');

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const priceRange = (prices: number[]) => {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} - ${money(max)}`;
};

export const dateText = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 一件商品對外顯示的「最低價那個規格」：卡片價格與折扣都以它為準 */
export const cheapestVariant = <T extends { price: number }>(variants: T[]) =>
  variants.reduce((min, v) => (v.price < min.price ? v : min), variants[0]);

/** 規格的折扣百分比；沒有原價或原價不合理就回 0 */
export const discountOf = (v?: { price: number; originalPrice?: number }) =>
  v?.originalPrice && v.originalPrice > v.price
    ? Math.round((1 - v.price / v.originalPrice) * 100)
    : 0;
