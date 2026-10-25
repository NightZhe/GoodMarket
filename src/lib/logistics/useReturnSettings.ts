import { useCallback, useEffect, useRef, useState } from 'react';
import { toAccountError } from '../account/errors';
import { fetchReturnSettings } from './api';
import type { ReturnReadPhase, ReturnSettings } from './returnStore';

interface Options {
  /** 超過這麼久沒回應就當作失敗（畫面轉成失敗狀態）；請求仍在飛，晚到的成功結果照樣採用 */
  timeoutMs: number;
  /** 回到前景時（距離上次讀取超過 60 秒）靜默重讀：別的裝置可能改過 */
  refreshOnVisible?: boolean;
}

const STALE_MS = 60_000;

/**
 * 讀店主的退貨設定（物流設定頁、新增／編輯表單、賣場總覽提示卡共用）。
 * settings 為 null＝從來沒讀到過；靜默重讀（silent）期間保留舊資料、失敗也不換成錯誤畫面。
 * phase：loading｜ready｜error（網路或伺服器失敗）｜unavailable（資料庫還沒套 migration，R-L17）。
 * 同時只採用最後發出的那一次讀取。
 */
export function useReturnSettings({ timeoutMs, refreshOnVisible = false }: Options) {
  const [settings, setSettings] = useState<ReturnSettings | null>(null);
  const [phase, setPhase] = useState<ReturnReadPhase>('loading');
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef<ReturnReadPhase>('loading');
  phaseRef.current = phase;

  const reload = useCallback(async (silent = false): Promise<boolean> => {
    const mine = ++seq.current;
    // 明確離線：不必等請求逾時，直接進失敗狀態；連線回來時（下面的 online 監聽）會自動重讀
    if (!silent) setPhase(navigator.onLine === false ? 'error' : 'loading');
    const timer = silent ? null : setTimeout(() => { if (alive.current && seq.current === mine) setPhase('error'); }, timeoutMs);
    try {
      const next = await fetchReturnSettings();
      if (!alive.current || seq.current !== mine) return false;
      lastRead.current = Date.now();
      setSettings(next);
      setPhase('ready');
      return true;
    } catch (e) {
      if (alive.current && seq.current === mine && !silent) setPhase(toAccountError(e).kind === 'backend_missing' ? 'unavailable' : 'error');
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

  return { settings, phase, reload };
}
