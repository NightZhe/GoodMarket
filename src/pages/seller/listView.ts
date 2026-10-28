// 賣家列表頁「列表區這一刻該顯示哪一態」的判斷（純函式，好測）。核心原則：讀不到不能畫成「沒有資料」。

/** loading＝載入態；error＝讀不到且沒有資料（取代空態）；stale＝讀不到但畫面有上次的資料；normal＝其餘（含真的沒有商品的空態） */
export type ProductsListView = 'loading' | 'error' | 'stale' | 'normal';

/**
 * failed＝上次讀取失敗，或正在重試那次失敗。
 * 重試一開始 store 就把 loadError 清成 null、loading 仍是 false、商品仍是空，
 * 所以呼叫端要自己把「重試中」併進 failed，否則重試期間會閃出「還沒有商品」。
 */
export function productsListView(i: { loading: boolean; failed: boolean; hasProducts: boolean }): ProductsListView {
  if (i.loading) return 'loading';
  if (!i.failed) return 'normal';
  return i.hasProducts ? 'stale' : 'error';
}
