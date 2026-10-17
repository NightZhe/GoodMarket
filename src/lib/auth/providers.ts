// 登入提供者有沒有啟用：Supabase 專案裡沒啟用的提供者，按了會落在一頁英文 JSON 錯誤。
// 啟動時讀一次公開的 /auth/v1/settings，沒啟用的那顆按鈕就不顯示；讀不到時照常顯示兩顆（寧可多顯示，也不要因為讀取失敗少一種登入方式）。

export interface EnabledProviders { google: boolean; apple: boolean }

export const ALL_PROVIDERS: EnabledProviders = { google: true, apple: true };

/** 只有明確是 false 才算沒啟用；欄位不見、型別不對、整份格式不對都當作啟用 */
export function parseProviderSettings(json: unknown): EnabledProviders {
  if (typeof json !== 'object' || json === null) return ALL_PROVIDERS;
  const ext = (json as { external?: unknown }).external;
  if (typeof ext !== 'object' || ext === null) return ALL_PROVIDERS;
  const e = ext as Record<string, unknown>;
  return { google: e.google !== false, apple: e.apple !== false };
}

const TIMEOUT_MS = 5000;

/** 讀取失敗（網路、逾時、非 2xx、不是 JSON）一律回傳「兩顆都顯示」，不丟錯誤 */
export async function fetchProviderSettings(
  baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch,
): Promise<EnabledProviders> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: apiKey }, signal: ctl.signal });
    if (!res.ok) return ALL_PROVIDERS;
    return parseProviderSettings(await res.json());
  } catch {
    return ALL_PROVIDERS;
  } finally {
    clearTimeout(timer);
  }
}
