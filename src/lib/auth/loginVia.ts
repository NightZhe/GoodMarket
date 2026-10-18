import type { LoginProvider, LoginVia } from './identity';
import type { StorageLike } from './pending';

// 綁定手機成功後，記下「綁定前是用什麼登入」，帳號頁才不會把 Google 登入說成手機登入（identity.ts 的 loginProviderOf）。
// 只存在這個分頁、只記登入方式與時間，沒有任何個資。

const KEY = 'goodmarket_login_via';
const PROVIDERS: readonly string[] = ['google', 'apple', 'phone', 'email', 'other'];

export function rememberVia(store: StorageLike | null, userId: string, via: LoginVia): void {
  if (!store) return;
  try { store.setItem(KEY, JSON.stringify({ uid: userId, provider: via.provider, at: via.at })); } catch { /* 存不進去就維持照 amr 說 */ }
}

export function readVia(store: StorageLike | null, userId: string): LoginVia | null {
  if (!store) return null;
  try {
    const d: unknown = JSON.parse(store.getItem(KEY) ?? 'null');
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    if (o.uid !== userId || typeof o.provider !== 'string' || !PROVIDERS.includes(o.provider) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
    return { provider: o.provider as LoginProvider, at: o.at };
  } catch {
    return null;
  }
}

export function clearVia(store: StorageLike | null): void {
  if (!store) return;
  try { store.removeItem(KEY); } catch { /* 刪不掉也沒有更多能做的 */ }
}
