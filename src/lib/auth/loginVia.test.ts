import { describe, expect, it } from 'vitest';
import type { StorageLike } from './pending';
import { readVia, rememberVia } from './loginVia';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; };

describe('綁定前的登入方式', () => {
  it('存取來回一致；只認同一個帳號', () => {
    const s = mem();
    rememberVia(s, 'u1', { provider: 'google', at: 123 });
    expect(readVia(s, 'u1')).toEqual({ provider: 'google', at: 123 });
    expect(readVia(s, 'u2')).toBeNull();
  });
  it('壞資料、儲存被擋：回 null，不當機', () => {
    const s = mem();
    s.setItem('goodmarket_login_via', '{"uid":"u1","provider":"hacker","at":1}');
    expect(readVia(s, 'u1')).toBeNull();
    s.setItem('goodmarket_login_via', 'oops');
    expect(readVia(s, 'u1')).toBeNull();
    const blocked: StorageLike = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    expect(() => rememberVia(blocked, 'u1', { provider: 'apple', at: 1 })).not.toThrow();
    expect(readVia(blocked, 'u1')).toBeNull();
    expect(readVia(null, 'u1')).toBeNull();
  });
});
