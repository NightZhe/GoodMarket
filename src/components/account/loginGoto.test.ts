import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../../lib/auth/pending';
import { GOTO_KEY, GOTO_TTL_MS, clearGoto, rememberGoto, takeGoto } from './loginGoto';

const mem = (opts: { failWrite?: boolean } = {}): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (opts.failWrite) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
};
const NOW = 1_800_000_000_000;

describe('登入後導頁（我的頁未登入時按需要登入的列）', () => {
  it('記下目標，登入回來取用得到同一頁，而且只能取一次', () => {
    const s = mem();
    expect(rememberGoto(s, '/orders', NOW)).toBe(true);
    expect(takeGoto(s, NOW + 1000)).toBe('/orders');
    expect(takeGoto(s, NOW + 1000)).toBeNull();
  });

  it('放太久（登入中途離開很久）就當作沒有，並且清掉', () => {
    const s = mem();
    rememberGoto(s, '/cart', NOW);
    expect(takeGoto(s, NOW + GOTO_TTL_MS)).toBeNull();
    expect(s.data.has(GOTO_KEY)).toBe(false);
  });

  it('只認得我的頁上那三個入口；被竄改成別的路徑或壞資料一律不導頁', () => {
    const s = mem();
    expect(rememberGoto(s, '/seller', NOW)).toBe(false);
    s.data.set(GOTO_KEY, JSON.stringify({ to: 'https://evil.example', at: NOW }));
    expect(takeGoto(s, NOW)).toBeNull();
    s.data.set(GOTO_KEY, '{不是 json');
    expect(takeGoto(s, NOW)).toBeNull();
    s.data.set(GOTO_KEY, JSON.stringify({ to: '/account/addresses', at: '昨天' }));
    expect(takeGoto(s, NOW)).toBeNull();
  });

  it('取消登入：clearGoto 之後登入也不會被帶去那一頁', () => {
    const s = mem();
    rememberGoto(s, '/account/addresses', NOW);
    clearGoto(s);
    expect(takeGoto(s, NOW)).toBeNull();
  });

  it('瀏覽器擋住暫存時回報 false，不丟例外', () => {
    expect(rememberGoto(mem({ failWrite: true }), '/orders', NOW)).toBe(false);
  });
});
