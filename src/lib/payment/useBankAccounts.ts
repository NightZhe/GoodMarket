import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyBankAccounts, isBankUnavailable } from './api';
import { payoutState, type BankAccountList, type PayoutState } from './bankAccount';
import { useRefreshOnVisible } from '../../store/ReviewsContext';

/** loading＝第一次讀；error＝讀不到（網路、逾時）；unavailable＝資料庫還沒升級（PGRST202），銀行帳號區顯示「暫時無法使用」 */
export type BankPhase = 'loading' | 'ready' | 'error' | 'unavailable';

const STALE_MS = 60_000;

/**
 * 讀我的銀行帳號。data 為 null＝從來沒讀到過；重新讀取（silent）期間保留舊列表，不閃骨架。
 * 同時只採用最後發出的那一次讀取。不把列表快取到下次開啟（也沒有完整帳號可快取）。
 * setList：寫入動作（新增、刪除、設撥款帳號）的回傳就是更新後的完整列表，直接取代。
 */
export function useBankAccounts({ timeoutMs, refreshOnReturn = false, paused = false }: { timeoutMs: number; refreshOnReturn?: boolean; paused?: boolean }) {
  const [data, setData] = useState<BankAccountList | null>(null);
  const [phase, setPhase] = useState<BankPhase>('loading');
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef<BankPhase>('loading');
  phaseRef.current = phase;

  const reload = useCallback(async (silent = false): Promise<boolean> => {
    const mine = ++seq.current;
    if (!silent) setPhase(navigator.onLine === false ? 'error' : 'loading');
    const timer = silent ? null : setTimeout(() => { if (alive.current && seq.current === mine) setPhase('error'); }, timeoutMs);
    try {
      const next = await fetchMyBankAccounts();
      if (!alive.current || seq.current !== mine) return false;
      lastRead.current = Date.now();
      setData(next);
      setPhase('ready');
      return true;
    } catch (e) {
      if (alive.current && seq.current === mine && !silent) setPhase(isBankUnavailable(e) ? 'unavailable' : 'error');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [timeoutMs]);

  const setList = useCallback((next: BankAccountList) => {
    seq.current++; // 之前還在飛的讀取不能把新結果蓋回舊的
    lastRead.current = Date.now();
    setData(next);
    setPhase('ready');
  }, []);

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

  return { data, phase, reload, setList };
}

/**
 * 撥款帳號狀態（側欄、賣場總覽的徽章）。null＝還沒讀到或讀不到（含資料庫未升級）：
 * 呼叫端不顯示狀態，不顯示「載入中」也不顯示錯誤。enabled＝false（功能開關關著）時完全不讀。
 */
export function usePayoutState(enabled: boolean): PayoutState | null {
  const [state, setState] = useState<PayoutState | null>(null);
  const load = () => { fetchMyBankAccounts().then(l => setState(payoutState(l.accounts)), () => undefined); };
  useEffect(() => { if (enabled) load(); else setState(null); }, [enabled]);
  useRefreshOnVisible(() => { if (enabled) load(); });
  return state;
}
