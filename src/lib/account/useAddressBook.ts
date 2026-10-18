import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAddresses, type AddressRow } from './addresses';

export type BookPhase = 'loading' | 'ready' | 'error';

interface Options {
  /** 超過這麼久沒回應就當作失敗（畫面轉成失敗狀態）；請求仍在飛，晚到的成功結果照樣採用 */
  timeoutMs: number;
  /** 回到前景時（距離上次讀取超過 60 秒）靜默重讀：別的裝置可能改過 */
  refreshOnVisible?: boolean;
}

const STALE_MS = 60_000;

/**
 * 讀地址簿。rows 為 null＝從來沒讀到過；重新讀取期間（silent）保留舊列表，不閃骨架。
 * 同時只採用最後發出的那一次讀取（寫入後重讀、回前景重讀可能重疊）。
 */
export function useAddressBook({ timeoutMs, refreshOnVisible = false }: Options) {
  const [rows, setRows] = useState<AddressRow[] | null>(null);
  const [phase, setPhase] = useState<BookPhase>('loading');
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef<BookPhase>('loading');
  phaseRef.current = phase;

  const reload = useCallback(async (silent = false): Promise<boolean> => {
    const mine = ++seq.current;
    // 明確離線：不必等請求逾時（supabase-js 讀取失敗會自己重試好幾秒），直接進失敗狀態；連線回來時（下面的 online 監聽）會自動重讀
    if (!silent) setPhase(navigator.onLine === false ? 'error' : 'loading');
    const timer = silent ? null : setTimeout(() => { if (alive.current && seq.current === mine) setPhase('error'); }, timeoutMs);
    try {
      const next = await fetchAddresses();
      if (!alive.current || seq.current !== mine) return false;
      lastRead.current = Date.now();
      setRows(next);
      setPhase('ready');
      return true;
    } catch {
      if (alive.current && seq.current === mine && !silent) setPhase('error');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [timeoutMs]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  useEffect(() => {
    const onOnline = () => { if (phaseRef.current === 'error') void reload(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  useEffect(() => {
    if (!refreshOnVisible) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > STALE_MS) void reload(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshOnVisible, reload]);

  return { rows, phase, reload };
}
