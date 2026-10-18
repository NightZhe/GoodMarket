import { describe, expect, it } from 'vitest';
import type { PendingInput } from '../../lib/auth/pending';
import { headingFor } from '../../lib/auth/headings';

const base = { inApp: null, ios: true } as const;
const checkout: PendingInput = { kind: 'checkout', items: [{ productId: 'p', variantId: 'v', qty: 1 }], fromCart: false, payment: 'cod', address: {
  source: 'manual', bookId: null, name: '甲', phone: '0912345678', zip: '106', city: '臺北市', district: '大安區', detail: '某路1號', saveToBook: false,
} };

describe('headingFor：登入已過期的說明依情境', () => {
  it('結帳：維持原句（收件資料、付款方式、商品都會還原）', () => {
    const h = headingFor({ ...base, trigger: checkout, expired: true });
    expect(h).toEqual({ title: '登入已過期', description: '請重新登入。你填的收件資料、付款方式和商品都還在。' });
  });
  it('個人檔案與地址表單（待辦動作是 goto）：不提付款方式與商品', () => {
    const h = headingFor({ ...base, trigger: { kind: 'goto' }, expired: true });
    expect(h.title).toBe('登入已過期');
    expect(h.description).toBe('請重新登入。你剛才填的內容都還在。');
    expect(h.description).not.toMatch(/付款方式|商品|收件資料/);
  });
  it('沒有待辦動作時也用中性句', () => {
    expect(headingFor({ ...base, trigger: null, expired: true }).description).toBe('請重新登入。你剛才填的內容都還在。');
  });
  it('沒過期：標題與說明不受影響', () => {
    expect(headingFor({ ...base, trigger: null, expired: false }).title).toBe('登入好物集');
  });
});
