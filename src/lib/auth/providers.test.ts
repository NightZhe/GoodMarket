import { describe, expect, it, vi } from 'vitest';
import { ALL_PROVIDERS, fetchProviderSettings, parseProviderSettings } from './providers';

describe('parseProviderSettings', () => {
  it('讀 external.google／external.apple', () => {
    expect(parseProviderSettings({ external: { google: true, apple: false, email: true } })).toEqual({ google: true, apple: false });
    expect(parseProviderSettings({ external: { google: false, apple: true } })).toEqual({ google: false, apple: true });
    expect(parseProviderSettings({ external: { google: false, apple: false } })).toEqual({ google: false, apple: false });
  });
  it('欄位不見或型別不對：當作啟用（讀不準就照常顯示）', () => {
    expect(parseProviderSettings({ external: {} })).toEqual(ALL_PROVIDERS);
    expect(parseProviderSettings({ external: { google: 'no', apple: 0 } })).toEqual(ALL_PROVIDERS);
    expect(parseProviderSettings({})).toEqual(ALL_PROVIDERS);
    expect(parseProviderSettings(null)).toEqual(ALL_PROVIDERS);
    expect(parseProviderSettings('x')).toEqual(ALL_PROVIDERS);
    expect(parseProviderSettings({ external: [] })).toEqual(ALL_PROVIDERS);
  });
});

describe('fetchProviderSettings', () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('帶 apikey 讀公開的 /auth/v1/settings，網址結尾斜線不會變成兩條', async () => {
    const f = ok({ external: { google: true, apple: false } });
    expect(await fetchProviderSettings('https://x.supabase.co/', 'KEY', f)).toEqual({ google: true, apple: false });
    expect(f).toHaveBeenCalledWith('https://x.supabase.co/auth/v1/settings', expect.objectContaining({ headers: { apikey: 'KEY' } }));
  });
  it('讀不到都回「兩顆都顯示」：網路錯誤、非 2xx、不是 JSON', async () => {
    expect(await fetchProviderSettings('https://x', 'k', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).toEqual(ALL_PROVIDERS);
    expect(await fetchProviderSettings('https://x', 'k', (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch)).toEqual(ALL_PROVIDERS);
    expect(await fetchProviderSettings('https://x', 'k', (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toEqual(ALL_PROVIDERS);
  });
});
