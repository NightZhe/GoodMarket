import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPaymentMethods } from './api';
import type { PaymentMethodRow } from './types';

export type CardsPhase = 'loading' | 'ready' | 'error';

interface Options {
  /** 超過這麼久沒回應就當作失敗；請求仍在飛，晚到的成功結果照樣採用 */
  timeoutMs: number;
  /** 回到前景（距離上次讀取超過 60 秒）、iOS 返回鍵還原整頁快照（pageshow persisted）時靜默重讀 */
  refreshOnReturn?: boolean;
  /** true＝先不讀（線上付款開關還沒確定或關著時，結帳頁不該去碰卡片表） */
  paused?: boolean;
}

const STALE_MS = 60_000;

/**
 * 讀我的信用卡（view my_payment_methods）。rows 為 null＝從來沒讀到過；重新讀取（silent）期間保留舊列表，不閃骨架。
 * 同時只採用最後發出的那一次讀取。不把列表快取到下次開啟（R-10）。
 */
export function useCards({ timeoutMs, refreshOnReturn = false, paused = false }: Options) {
  const [rows, setRows] = useState<PaymentMethodRow[] | null>(null);
  const [phase, setPhase] = useState<CardsPhase>('loading');
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef<CardsPhase>('loading');
  phaseRef.current = phase;

  const reload = useCallback(async (silent = false): Promise<boolean> => {
    const mine = ++seq.current;
    if (!silent) setPhase(navigator.onLine === false ? 'error' : 'loading');
    const timer = silent ? null : setTimeout(() => { if (alive.current && seq.current === mine) setPhase('error'); }, timeoutMs);
    try {
      const next = await fetchPaymentMethods();
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
    if (!paused) void reload();
    return () => { alive.current = false; };
  }, [reload, paused]);

  useEffect(() => {
    const onOnline = () => { if (phaseRef.current === 'error') void reload(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  useEffect(() => {
    if (!refreshOnReturn) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > STALE_MS) void reload(true);
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void reload(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onShow);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pageshow', onShow); };
  }, [refreshOnReturn, reload]);

  return { rows, phase, reload };
}
