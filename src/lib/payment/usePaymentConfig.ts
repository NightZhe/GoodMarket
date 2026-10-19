import { useEffect, useState } from 'react';
import { fetchPaymentConfig } from './api';

// 線上付款功能開關（payment_config）。關著、或讀不到（網路、資料庫還沒升級）時一律當作關：
// 所有線上付款入口都不顯示，舊流程不受影響。讀到的結果在記憶體裡快取 60 秒，頁面之間切換不會每次都重問。

const FRESH_MS = 60_000;
let cache: { enabled: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  inflight ??= fetchPaymentConfig()
    .then(enabled => { cache = { enabled, at: Date.now() }; return enabled; })
    // 讀不到：當作關著，但不蓋掉舊的快取結果時間，下次還會再問
    .catch(() => { cache = { enabled: false, at: 0 }; return false; })
    .finally(() => { inflight = null; });
  return inflight;
}

export interface PaymentConfigState {
  /** 開關有沒有打開（沒讀到前是 false） */
  enabled: boolean;
  /** 是否已經有答案（含讀取失敗）；結帳頁用它決定要不要先放骨架 */
  ready: boolean;
}

export function usePaymentConfig(): PaymentConfigState {
  const [state, setState] = useState<PaymentConfigState>(() => ({ enabled: cache?.enabled ?? false, ready: cache !== null && cache.at > 0 }));
  useEffect(() => {
    let alive = true;
    if (cache && Date.now() - cache.at < FRESH_MS && cache.at > 0) return;
    void load().then(enabled => { if (alive) setState({ enabled, ready: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

/** 重讀（頁面回到前景、使用者按重試）：回傳最新結果 */
export const refreshPaymentConfig = (): Promise<boolean> => load();
