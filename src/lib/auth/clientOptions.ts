import type { SupabaseClientOptions } from '@supabase/supabase-js';
import type { AsyncStorageLike } from './sessionStore';

type AuthOptions = NonNullable<SupabaseClientOptions<'public'>['auth']>;

// Supabase client 的 auth 設定（純函式，給 supabase.ts 用、給測試看 AC-7）。
// 本站是 hash 路由，implicit 流程把 token 接在 # 後面，會跟路由打架，所以用 PKCE（回跳網址是 ?code=）。
// detectSessionInUrl 關掉：?code= 由 AuthBoot 在路由掛載之前自己換（要能顯示「登入中」、處理失敗與取消）。
export const WEB_AUTH_OPTIONS = {
  persistSession: true, autoRefreshToken: true, flowType: 'pkce', detectSessionInUrl: false,
} as const satisfies AuthOptions;

/**
 * 網頁版：維持預設儲存（localStorage），設定與 keep-signed-in 之前完全相同。
 * App 內：多一個 storage＝session 儲存轉接器（安全儲存＋備援），其餘不變。
 */
export function authOptions(nativeStore: AsyncStorageLike | null): AuthOptions {
  return nativeStore ? { ...WEB_AUTH_OPTIONS, storage: nativeStore } : WEB_AUTH_OPTIONS;
}
