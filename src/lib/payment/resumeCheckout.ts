import { clearPending, isExpired, peekPending, type CheckoutAddress, type PaymentMethod, type StorageLike } from '../auth/pending';
import type { CartItem } from '../../types';

// 結帳頁要離開去綁卡（3D 驗證整頁跳轉）時，把結帳的狀態放進「待辦動作」（跟登入過期同一套機制）；
// 回到結帳時從這裡取出還原。只有結帳那一種待辦動作會被取走，其他種類原封不動。

export interface CheckoutSnapshot {
  items: CartItem[];
  fromCart: boolean;
  payment: PaymentMethod;
  cardId: string | null;
  address: CheckoutAddress;
}

export function takeCheckoutSnapshot(stores: StorageLike[], now: number): CheckoutSnapshot | null {
  const rec = peekPending(stores, now);
  if (!rec || rec.action.kind !== 'checkout') return null;
  clearPending(stores);
  if (isExpired(rec.action, now)) return null;
  const { items, fromCart, payment, cardId, address } = rec.action;
  return { items, fromCart, payment, cardId, address };
}
