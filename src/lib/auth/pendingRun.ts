// R-8：待辦動作什麼時候可以執行。純函式，PendingRunner 用它決定要不要跑。
//   - 手機驗證成功不會整頁轉址，runPendingOnLoad 永遠是 false；所以 AuthContext 在使用者按「確認」並驗證成功時
//     把 phoneLoginTick 加 1，每一次手機登入是一個新的 key。
//   - 一定要等 shopReady，D12（不能買自己商店的商品）才判斷得準。
//   - 同一個 key 只執行一次：重新整理、上一頁、StrictMode 重跑 effect 都不會再觸發。

export interface RunGate {
  /** 剛從 Google／Apple 轉址登入回來 */
  runPendingOnLoad: boolean;
  /** 這次載入內，手機驗證成功了幾次（使用者按「確認」才會加） */
  phoneLoginTick: number;
  /** 上一次已經執行過的 key；沒有就是 null */
  lastRanKey: number | null;
  authReady: boolean;
  loading: boolean;
  hasUser: boolean;
  shopReady: boolean;
}

/** 這一次該執行的 key；現在不該執行就是 null */
export function pendingRunKey(g: RunGate): number | null {
  const key = g.phoneLoginTick > 0 ? g.phoneLoginTick : g.runPendingOnLoad ? 0 : null;
  if (key === null || key === g.lastRanKey) return null;
  if (!g.authReady || g.loading || !g.hasUser || !g.shopReady) return null;
  return key;
}
