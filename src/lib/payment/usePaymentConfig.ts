import { useEffect, useState } from 'react';
import { fetchPaymentConfigFull } from './api';
import type { PaymentConfig } from './types';

// 線上付款功能開關（payment_config）。關著、或讀不到（網路、資料庫還沒升級）時一律當作關：
// 所有線上付款入口都不顯示，舊流程不受影響。讀到的結果在記憶體裡快取 60 秒，頁面之間切換不會每次都重問。
// PR-乙：同一次請求順便帶回平台收款開關與打開時間（舊資料庫沒有這兩欄→關、null；parsePaymentConfig 降級），
// 既有 enabled／ready 的語意與快取行為不變。

const FRESH_MS = 60_000;
const OFF: PaymentConfig = { onlinePaymentEnabled: false, platformCollectEnabled: false, platformCollectEnabledAt: null };
let cache: { cfg: PaymentConfig; at: number } | null = null;
let inflight: Promise<PaymentConfig> | null = null;

function load(): Promise<PaymentConfig> {
  inflight ??= fetchPaymentConfigFull()
    .then(cfg => { cache = { cfg, at: Date.now() }; return cfg; })
    // 讀不到：當作關著，但不蓋掉舊的快取結果時間，下次還會再問
    .catch(() => { cache = { cfg: OFF, at: 0 }; return OFF; })
    .finally(() => { inflight = null; });
  return inflight;
}

export interface PaymentConfigState {
  /** 開關有沒有打開（沒讀到前是 false） */
  enabled: boolean;
  /** 是否已經有答案（含讀取失敗）；結帳頁用它決定要不要先放骨架 */
  ready: boolean;
  /** 平台收款開關（PR-乙 IN-B1）；沒讀到、舊資料庫一律 false */
  platformCollectEnabled: boolean;
  /** 最近一次打開平台收款的時間（ISO）；沒開過、沒讀到一律 null */
  platformCollectEnabledAt: string | null;
}

/** 純函式：快取內容 → hook 的狀態 */
export const configState = (cfg: PaymentConfig, ready: boolean): PaymentConfigState => ({
  enabled: cfg.onlinePaymentEnabled, ready,
  platformCollectEnabled: cfg.platformCollectEnabled, platformCollectEnabledAt: cfg.platformCollectEnabledAt,
});

export function usePaymentConfig(): PaymentConfigState {
  const [state, setState] = useState<PaymentConfigState>(() => configState(cache?.cfg ?? OFF, cache !== null && cache.at > 0));
  useEffect(() => {
    let alive = true;
    if (cache && Date.now() - cache.at < FRESH_MS && cache.at > 0) return;
    void load().then(cfg => { if (alive) setState(configState(cfg, true)); });
    return () => { alive = false; };
  }, []);
  return state;
}

/** 重讀（頁面回到前景、使用者按重試）：回傳最新的線上付款開關 */
export const refreshPaymentConfig = (): Promise<boolean> => load().then(cfg => cfg.onlinePaymentEnabled);
