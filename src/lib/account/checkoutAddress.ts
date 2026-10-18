import type { CheckoutAddress } from '../auth/pending';
import type { Order } from '../../types';
import { composeAddress, formatPhone, normalizePhone, type AddressDraft } from './address';
import type { AddressRow } from './addresses';
import { zipOf } from './regions';

// 結帳頁的收件資料：從地址簿選一筆（book）或手動填（manual），統一成 CheckoutAddress 快照，
// 訂單存的是快照組成的文字（R-A9、R-A19），之後改或刪地址簿都不影響已成立的訂單。

export const addressFromRow = (r: AddressRow): CheckoutAddress => ({
  source: 'book', bookId: r.id, name: r.recipient, phone: r.phone,
  zip: r.postal_code, city: r.city, district: r.district, detail: r.detail, saveToBook: false,
});

export const addressFromDraft = (d: AddressDraft, saveToBook: boolean): CheckoutAddress => ({
  source: 'manual', bookId: null, name: d.recipient.trim(), phone: d.phone.trim(),
  zip: zipOf(d.city, d.district) ?? '', city: d.city, district: d.district, detail: d.detail.trim(), saveToBook,
});

/**
 * 結帳頁「地址簿那一筆」該顯示什麼。
 * pickId：使用者這次結帳選的那一筆（null＝沒換過，用預設）；frozen：登入過期還原回來的快照。
 * 選的那一筆還在地址簿裡 → 以地址簿現在的內容為準；已經被刪了 → 仍顯示快照（AC-A25），不悄悄退回預設。
 */
export function pickBookAddress(rows: AddressRow[] | null, pickId: string | null, frozen: CheckoutAddress | null): CheckoutAddress | null {
  const picked = pickId ? rows?.find(r => r.id === pickId) : undefined;
  if (picked) return addressFromRow(picked);
  if (frozen && frozen.bookId === pickId) return frozen;
  if (rows && rows.length > 0) return addressFromRow(rows.find(r => r.is_default) ?? rows[0]);
  return null;
}

/** 寫進訂單的收件資料：地址是「郵遞區號 縣市區詳細地址」，手機統一成 0912-345-678 */
export function buyerOf(a: CheckoutAddress): Order['buyer'] {
  const digits = normalizePhone(a.phone);
  return { name: a.name, phone: digits ? formatPhone(digits) : a.phone, address: composeAddress(a) };
}
