import type { Category, CategoryId, Product } from '../../types';

/**
 * 首頁分類膠囊與搜尋頁 chips 的顯示順序：依在架（active）商品數由多到少；
 * 同數量照傳入的順序（Array.prototype.sort 為穩定排序）。0 件的分類保留在最後，不隱藏。
 */
export function orderCategories(categories: Category[], products: Product[]): Category[] {
  const counts = new Map<CategoryId, number>();
  for (const p of products) {
    if (p.status !== 'active') continue;
    counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  }
  return [...categories].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
}
