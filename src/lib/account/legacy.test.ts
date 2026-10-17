import { describe, expect, it } from 'vitest';
import { LEGACY_CLEANED_KEY, cleanLegacyStorage } from './legacy';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null,
  };
};

describe('cleanLegacyStorage（D16、D17＝B）', () => {
  it('舊購物車與訂單憑證每次載入都清掉；收件資料與帳號相關資料不動', () => {
    const local = store({ goodmarket_cart: '[1]', goodmarket_order_keys: '[2]', goodmarket_buyer: '{}' });
    cleanLegacyStorage(local, store());
    expect([...local.m.keys()].sort()).toEqual(['goodmarket_buyer', LEGACY_CLEANED_KEY].sort());
  });
  it('舊的評價草稿只清第一次；之後新寫的草稿要留著（Safari 回收頁面後靠它還原）', () => {
    const local = store(); const session = store({ 'goodmarket_review_draft:old': 'x', other: 'y' });
    cleanLegacyStorage(local, session);
    expect([...session.m.keys()]).toEqual(['other']);
    session.setItem('goodmarket_review_draft:new', 'z');
    cleanLegacyStorage(local, session);
    expect(session.getItem('goodmarket_review_draft:new')).toBe('z');
  });
  it('儲存空間被擋時不丟例外', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); }, length: 0, key: () => null };
    expect(() => cleanLegacyStorage(bad, bad)).not.toThrow();
  });
});
