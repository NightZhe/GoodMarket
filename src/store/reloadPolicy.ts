/**
 * 商品重讀（StoreContext.reload）回來之後怎麼處理：
 * apply＝更新商店與商品；report＝整頁換成「載入商品失敗」；ignore＝什麼都不動，畫面保留現有資料。
 * silent（背景重讀，例如進購物車、下單被擋後）失敗時 ignore；但如果它蓋掉了一個還沒回來的一般重讀
 * （loudPending），那次一般重讀本來會報錯或結束轉圈，所以照一般重讀處理
 */
export function settleReload({ ok, silent, loudPending }: { ok: boolean; silent: boolean; loudPending: boolean }): 'apply' | 'report' | 'ignore' {
  if (ok) return 'apply';
  return silent && !loudPending ? 'ignore' : 'report';
}
