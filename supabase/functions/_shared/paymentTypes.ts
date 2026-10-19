// 多店授權狀態機與補償程序共用的型別。不依賴 Deno、不依賴 supabase-js。

/**
 * 一筆授權（一家店的一張訂單、一次付款嘗試）的狀態：
 *   pending    還沒打綠界（意圖已寫入資料庫）
 *   calling    已打（或正要打）綠界，結果未落地：請求中、逾時、行程中斷都停在這裡 → 要靠查詢解決
 *   authorized 綠界回成功，佔用額度、未請款
 *   declined   確定沒有授權（被拒，或查詢確認綠界沒有這筆）
 *   captured   已送出關帳（綠界「要關帳」或「已關帳」）
 *   abandoned  已放棄／取消／退刷，或從頭到尾沒打過綠界
 */
export type AuthState = 'pending' | 'calling' | 'authorized' | 'declined' | 'captured' | 'abandoned';

export interface AuthRow {
  id: string;
  orderId: string;
  shopId: string;
  merchantId: string;       // 綠界特約商店編號
  merchantTradeNo: string;  // 每次嘗試都不同（綠界不允許重複使用）
  amount: number;
  state: AuthState;
  ecpayTradeNo: string | null;
  rtnCode: number | null;
  rtnMsg: string | null;
  /** 最後一次打綠界（授權）的時間，毫秒；pending 為 null */
  callStartedAt: number | null;
  /** 關帳／放棄動作累計失敗次數 */
  actionFailures: number;
  /** 這筆是被「查詢確認綠界沒有」而判成 declined，而不是銀行拒絕 */
  resolvedByQuery: boolean;
}

export type GroupDecision = 'capture' | 'abandon' | null;

export interface GroupView {
  id: string;
  decision: GroupDecision;
}

export type PlanStep =
  | { type: 'authorize'; auths: AuthRow[] }               // 打綠界授權
  | { type: 'decide'; decision: 'capture' | 'abandon' }   // 把決定寫入資料庫（之後所有動作都朝它收斂，可重入）
  | { type: 'skip'; auths: AuthRow[] }                    // 放棄決定後，從沒打過綠界的 pending → abandoned
  | { type: 'refresh'; auths: AuthRow[] }                 // 查綠界，把 calling 解決成 authorized / declined
  | { type: 'capture'; auths: AuthRow[] }
  | { type: 'abandon'; auths: AuthRow[] }
  | { type: 'finalize'; outcome: 'paid' | 'failed' }
  | { type: 'wait'; reason: 'in_flight' | 'blackout' | 'stuck' };

/** 關帳／放棄動作最多嘗試幾次，超過就改走另一邊（capture→abandon）或回報卡住（abandon） */
export const MAX_ACTION_FAILURES = 3;
/** calling 超過這麼久還沒落地，才去查綠界（授權呼叫的逾時是 40 秒） */
export const CALLING_STALE_MS = 60_000;
/** 查到綠界沒有這筆授權，還要等到這麼久才確定它不會晚到（銀行端慢回） */
export const NO_AUTH_CONFIRM_MS = 10 * 60_000;
