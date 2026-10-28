import { describe, expect, it } from 'vitest';
import { WEB_AUTH_OPTIONS, authOptions } from './clientOptions';
import type { AsyncStorageLike } from './sessionStore';

const fakeStore: AsyncStorageLike = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };

describe('AC-7 網頁版 Supabase client 設定與 keep-signed-in 之前相同', () => {
  it('網頁版（沒有原生儲存）：四個欄位原值，沒有 storage 欄位', () => {
    const o = authOptions(null);
    expect(o).toEqual({ persistSession: true, autoRefreshToken: true, flowType: 'pkce', detectSessionInUrl: false });
    expect('storage' in o).toBe(false);
    expect(o).toBe(WEB_AUTH_OPTIONS);
  });
  it('App 內：同樣四個欄位，只多 storage 指向轉接器', () => {
    const o = authOptions(fakeStore);
    expect(o).toEqual({ persistSession: true, autoRefreshToken: true, flowType: 'pkce', detectSessionInUrl: false, storage: fakeStore });
  });
});
