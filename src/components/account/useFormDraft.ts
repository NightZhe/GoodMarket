import { useCallback, useEffect, useRef } from 'react';
import { saveFormDraft, takeFormDraft, type FormDraft } from '../../lib/account/formDraft';
import type { StorageLike } from '../../lib/auth/pending';
import { useAuth } from '../../store/AuthContext';

function sessionStore(): StorageLike | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/**
 * 登入過期時按了儲存（R-A16）：先把輸入暫存起來，再開登入面板。
 * 登入是整頁跳轉，回來後 useRestoreFormDraft 會把輸入還原一次；不自動送出。
 */
export function useRelogin() {
  const { openLogin } = useAuth();
  return useCallback((draft: FormDraft) => {
    const store = sessionStore();
    if (store) saveFormDraft(store, draft, Date.now());
    openLogin({ trigger: { kind: 'goto' }, expired: true });
  }, [openLogin]);
}

/**
 * 進頁時取回登入前暫存的輸入，只還原一次。只有「剛從登入回來」的這次載入才還原；
 * 否則（例如使用者在登入面板按了關閉）暫存是過期的，取出來丟掉。
 * kind 對不上（草稿是另一個表單的）也丟掉。
 */
export function useRestoreFormDraft(kind: FormDraft['kind'], apply: (d: FormDraft) => void) {
  const { runPendingOnLoad } = useAuth();
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const store = sessionStore();
    if (!store) return;
    const d = takeFormDraft(store, Date.now());
    if (d && runPendingOnLoad && d.kind === kind) applyRef.current(d);
  }, [kind, runPendingOnLoad]);
}
