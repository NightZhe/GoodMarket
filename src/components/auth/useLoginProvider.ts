import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { loginProviderOf, type AuthMethod, type LoginProvider } from '../../lib/auth/identity';
import { readVia } from '../../lib/auth/loginVia';
import { currentLoginMethods } from '../../lib/auth/phoneApi';
import { flowStore } from '../../lib/auth/phoneFlow';

/**
 * 這個帳號「這一次」用什麼登入（R-26）。簡訊登入不會更新手機身分的 last_sign_in_at，
 * 所以要讀 session 的 amr；amr 還沒讀到的那一瞬間先用身分判斷，讀到再更正。沒登入是 null。
 */
export function useLoginProvider(user: User | null): LoginProvider | null {
  const [methods, setMethods] = useState<AuthMethod[] | null>(null);
  const key = user ? `${user.id}|${user.last_sign_in_at ?? ''}` : null;
  useEffect(() => {
    setMethods(null);
    if (!key) return;
    let alive = true;
    void currentLoginMethods().then(m => { if (alive) setMethods(m); });
    return () => { alive = false; };
  }, [key]);
  return user ? loginProviderOf(user, methods, readVia(flowStore(), user.id)) : null;
}
