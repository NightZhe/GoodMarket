import { useCallback, useEffect, useRef, useState } from 'react';
import { getDeletionStatus } from './api';
import { viewOfError, viewOfStatus, type DeletionView } from './status';

/**
 * full＝回到載入中再讀（進頁、換帳號）；keep＝畫面維持原樣，呼叫端自己顯示「重試中」（重試鈕）；
 * silent＝靜默：失敗保留原畫面（回前景、操作後重讀），只有「登入過期」會更新畫面
 */
export type ReloadMode = 'full' | 'keep' | 'silent';

const READ_TIMEOUT_MS = 10_000;
const STALE_MS = 60_000;

/**
 * 讀目前帳號的刪除申請狀態。userId＝null：不讀（未登入），view 為 null。
 * view 為 null＝還沒讀到（載入中）。同時只採用最後發出的那一次讀取；超過 10 秒沒回應當作失敗，晚到的成功結果照樣採用。
 * 明確離線不發請求直接當失敗，連線回來自動重讀。
 */
export function useDeletionStatus(userId: string | null) {
  const [view, setViewState] = useState<DeletionView | null>(null);
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const viewRef = useRef<DeletionView | null>(null);
  const setView = useCallback((v: DeletionView | null) => { viewRef.current = v; setViewState(v); }, []);

  /** 回傳這次讀取得到的畫面狀態；被後來的讀取取代、或靜默失敗＝null */
  const reload = useCallback(async (mode: ReloadMode = 'full'): Promise<DeletionView | null> => {
    if (userId === null) return null;
    const mine = ++seq.current;
    if (mode === 'full') setView(null);
    if (navigator.onLine === false && mode !== 'silent') {
      setView({ kind: 'error' });
      return { kind: 'error' };
    }
    const timer = mode === 'silent' ? null : setTimeout(() => { if (alive.current && seq.current === mine) setView({ kind: 'error' }); }, READ_TIMEOUT_MS);
    try {
      const next = viewOfStatus(await getDeletionStatus());
      if (!alive.current || seq.current !== mine) return null;
      lastRead.current = Date.now();
      setView(next);
      return next;
    } catch (e) {
      if (!alive.current || seq.current !== mine) return null;
      const next = viewOfError(e);
      if (mode !== 'silent' || next.kind === 'auth') { setView(next); return next; }
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [userId, setView]);

  useEffect(() => {
    alive.current = true;
    if (userId === null) { seq.current++; setView(null); } else void reload('full');
    return () => { alive.current = false; };
  }, [userId, reload, setView]);

  useEffect(() => {
    const onOnline = () => { if (viewRef.current?.kind === 'error') void reload('full'); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && viewRef.current !== null && Date.now() - lastRead.current > STALE_MS) void reload('silent');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  return { view, reload, setView };
}
