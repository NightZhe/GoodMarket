/**
 * 濾掉被封鎖店家的商品（R-K12：首頁、搜尋、同類商品、店家頁商品格）。純函式。
 * 沒有封鎖時回傳原陣列（同一個參考），讓依賴它的 useMemo 不白算。
 */
export function visibleProducts<T extends { shopId: string }>(products: T[], blockedIds: ReadonlySet<string>): T[] {
  if (blockedIds.size === 0) return products;
  return products.filter(p => !blockedIds.has(p.shopId));
}
