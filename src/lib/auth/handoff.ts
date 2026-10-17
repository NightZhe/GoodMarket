import { isExpired, type PendingAction } from './pending';

// 網址參數帶來的待辦動作（LINE 外開接續）是「任何人都能散布的連結」：絕對不能讓它在使用者沒按任何鈕的情況下執行。
// 規則：
//   - 只有「這個瀏覽器自己存下的待辦動作」，而且是「剛登入回來」，才可以自動執行（PendingRunner）。
//   - 網址參數只能預填（規格、數量帶入、登入面板的摘要），並且一律要使用者按一次才會動作：
//       沒登入 → 開登入面板，使用者按 Google／Apple 才會存起待辦動作；
//       已登入 → 在商品頁顯示「要加入購物車嗎？」，使用者按確認才加入。

export type BootOutcome = 'none' | 'signed_in' | 'cancelled' | 'failed';

/** 登入結果是不是「剛登入回來」。網址帶參數、一般載入、取消、失敗都不是 */
export const mayRunPending = (outcome: BootOutcome | null): boolean => outcome === 'signed_in';

export type HandoffDisposition =
  | 'none'          // 沒有網址帶來的動作
  | 'login_panel'   // 沒登入：開登入面板，摘要顯示帶來的選擇，使用者按登入鈕才算數
  | 'prefill_only'; // 沒登入但連結已經過期（超過 60 分鐘）：只預填，不在登入後自動完成
export type HandoffForLoggedIn = 'none' | 'confirm';

export function handoffWhenLoggedOut(h: PendingAction | null, now: number): HandoffDisposition {
  if (!h) return 'none';
  return isExpired(h, now) ? 'prefill_only' : 'login_panel';
}

/** 已登入：只有加入購物車、直接購買會要求確認；其餘（純登入）什麼都不做 */
export function handoffWhenLoggedIn(h: PendingAction | null): HandoffForLoggedIn {
  return h && (h.kind === 'add_to_cart' || h.kind === 'buy_now') ? 'confirm' : 'none';
}
