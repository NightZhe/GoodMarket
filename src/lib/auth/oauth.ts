import { supabase } from '../supabase';
import { redirectUrl } from './callback';

export type OAuthProvider = 'google' | 'apple';
export type OAuthStart = { ok: true } | { ok: false; reason: 'offline' | 'unavailable' };

/**
 * 整頁跳到 Google／Apple。成功時瀏覽器已經開始離開本頁（回傳值通常來不及被看見）。
 * 沒有網路時不發動（只擋明確的離線，不當作連線品質的保證）；供應商沒啟用、伺服器錯誤回 unavailable。
 */
export async function startOAuth(provider: OAuthProvider): Promise<OAuthStart> {
  if (navigator.onLine === false) return { ok: false, reason: 'offline' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectUrl(window.location) },
  });
  return error ? { ok: false, reason: 'unavailable' } : { ok: true };
}
