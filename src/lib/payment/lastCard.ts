import type { StorageLike } from '../auth/pending';

// 重新付款頁要「不預選剛失敗的那張卡」（設計 9.2），但後端的付款群組檢視（get_payment_group／payment-status）沒有回「用的是哪張卡」
// （payment_groups.payment_method_id 在資料庫裡，沒有透過檢視給出來）。所以這個瀏覽器分頁按付款時，自己記下「這個群組用了哪張卡」；
// 換瀏覽器或重新開分頁就記不得，退回預設規則。若之後後端把 paymentMethodId 放進 lastFail，這裡改讀它即可。

export const PAY_CARDS_KEY = 'goodmarket_pay_cards';
const KEEP = 5;

function read(store: StorageLike): Record<string, string> {
  try {
    const v: unknown = JSON.parse(store.getItem(PAY_CARDS_KEY) ?? '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 只留最近 KEEP 個群組（物件鍵依插入順序，舊的先掉） */
export function rememberPayCard(store: StorageLike, groupId: string, cardId: string): void {
  const map = read(store);
  delete map[groupId];
  map[groupId] = cardId;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete map[k];
  try { store.setItem(PAY_CARDS_KEY, JSON.stringify(map)); } catch { /* 儲存空間被擋：之後就只是不記得，退回預設規則 */ }
}

export function recallPayCard(store: StorageLike, groupId: string): string | null {
  const v = read(store)[groupId];
  return typeof v === 'string' ? v : null;
}

/** 剛失敗的卡：銀行拒絕（指出哪一家店）才算；系統問題不是卡的問題，重付預選同一張 */
export const failedCardIdOf = (failure: { shopId: string | null } | null, remembered: string | null): string | null =>
  failure && failure.shopId !== null ? remembered : null;
