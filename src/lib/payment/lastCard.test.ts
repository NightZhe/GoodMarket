import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../auth/pending';
import { failedCardIdOf, recallPayCard, rememberPayCard } from './lastCard';

const mem = (): StorageLike & { raw: () => string | null } => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k), raw: () => m.get('goodmarket_pay_cards') ?? null };
};

describe('rememberPayCard／recallPayCard：這個瀏覽器分頁這次付款用的是哪張卡', () => {
  it('記下後可以按付款群組取回', () => {
    const s = mem();
    rememberPayCard(s, 'g1', 'c1');
    rememberPayCard(s, 'g2', 'c2');
    expect(recallPayCard(s, 'g1')).toBe('c1');
    expect(recallPayCard(s, 'g2')).toBe('c2');
    expect(recallPayCard(s, 'g3')).toBeNull();
  });
  it('同一個群組換卡重付：以最後一次為準', () => {
    const s = mem();
    rememberPayCard(s, 'g1', 'c1');
    rememberPayCard(s, 'g1', 'c2');
    expect(recallPayCard(s, 'g1')).toBe('c2');
  });
  it('只留最近 5 個群組，不會無限長大', () => {
    const s = mem();
    for (let i = 0; i < 8; i++) rememberPayCard(s, `g${i}`, `c${i}`);
    expect(recallPayCard(s, 'g0')).toBeNull();
    expect(recallPayCard(s, 'g7')).toBe('c7');
    expect(Object.keys(JSON.parse(s.raw()!))).toHaveLength(5);
  });
  it('儲存內容壞掉或被擋：回 null、不丟錯', () => {
    const bad: StorageLike = { getItem: () => '{oops', setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    expect(recallPayCard(bad, 'g1')).toBeNull();
    expect(() => rememberPayCard(bad, 'g1', 'c1')).not.toThrow();
    const notObj = mem(); notObj.setItem('goodmarket_pay_cards', '[1,2]');
    expect(recallPayCard(notObj, 'g1')).toBeNull();
  });
});

describe('failedCardIdOf：重付區不預選的「剛失敗的卡」', () => {
  it('銀行拒絕（指出是哪一家店）：就是剛才用的那張', () => {
    expect(failedCardIdOf({ shopId: 's2' }, 'c1')).toBe('c1');
  });
  it('系統問題（沒有指出哪一家）：不是卡的問題，預選同一張，所以沒有「失敗的卡」', () => {
    expect(failedCardIdOf({ shopId: null }, 'c1')).toBeNull();
  });
  it('沒有失敗紀錄、或這個瀏覽器不記得用過哪張：null（退回預設規則）', () => {
    expect(failedCardIdOf(null, 'c1')).toBeNull();
    expect(failedCardIdOf({ shopId: 's2' }, null)).toBeNull();
  });
});
