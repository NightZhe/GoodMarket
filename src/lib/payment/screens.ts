import type { FailureInfo, PayResponse, PaymentErrorCode, PaymentGroupView } from './types';

// 付款結果頁（S-6）與結帳按下付款之後的去向。回應碼與狀態 → 畫面的對照集中在這裡，畫面只負責排版。

export type PayScreen = 'paid' | 'failed' | 'pay' | 'confirming' | 'expired' | 'cancelled' | 'exhausted';

/** 伺服器的付款群組狀態決定畫哪一種（網址參數一律不採信） */
export function screenOfGroup(g: PaymentGroupView): PayScreen {
  switch (g.status) {
    case 'paid': return 'paid';
    case 'pending': return g.lastFail ? 'failed' : 'pay';
    case 'processing': // 有請求還在跑：和確認中一樣不能再付
    case 'confirming': return 'confirming';
    case 'expired': return 'expired';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'exhausted'; // 5 次嘗試用盡，訂單已作廢
  }
}

/** payment-pay 成功回應的三種結果各自導到哪一個畫面 */
export const destinationOfPayResponse = (r: PayResponse): 'paid' | 'failed' | 'confirming' => r.outcome;

/**
 * payment-pay 回錯誤碼時該去哪：已付款、處理中、逾時都以結果頁（伺服器狀態）為準；
 * 找不到＝結果頁的「找不到這筆付款」；其餘（卡不見、店不能線上付、金額超限…）留在原地顯示訊息（null）
 */
export function destinationOfPayError(code: PaymentErrorCode): 'paid' | 'confirming' | 'expired' | 'notfound' | null {
  switch (code) {
    case 'ALREADY_PAID': return 'paid';
    case 'PAYMENT_IN_PROGRESS': return 'confirming';
    case 'ORDER_EXPIRED': return 'expired';
    case 'GROUP_NOT_FOUND': return 'notfound';
    default: return null;
  }
}

/** 結帳按下付款後：超過 8 秒補一句「還在處理」；超過 45 秒導到確認中頁，不回到可以再按一次的結帳頁（設計 8.3） */
export const SLOW_PAY_MS = 8_000;
export const WAIT_PAY_MS = 45_000;

/** 確認中頁的輪詢：每 3 秒一次、最多 3 分鐘（介面文件 4.3），之後停下來給「重新整理結果」按鈕 */
export const CONFIRM_POLL = { intervalMs: 3_000, maxMs: 180_000 } as const;

export function pollAction(screen: PayScreen, elapsedMs: number): { poll: false } | { poll: true; delayMs: number } {
  return screen === 'confirming' && elapsedMs < CONFIRM_POLL.maxMs ? { poll: true, delayMs: CONFIRM_POLL.intervalMs } : { poll: false };
}

export interface FailureContext {
  /** 失敗那家店的店名（系統問題時沒有） */
  failedShop: string | null;
  /** 其他店（授權已放棄的）店名 */
  otherShops: string[];
  orderCount: number;
}

const SYSTEM_PROBLEM = '綠界科技暫時無法處理這次付款，不是你的卡片有問題。可以再試一次。';

/** 失敗頁的原因句與結果句（設計 9.1）。銀行原因用後端給的中文，不顯示綠界原文 */
export function failureSentences(f: FailureInfo, c: FailureContext): { reason: string; result: string; cardInvalid: boolean } {
  const system = f.shopId === null || c.failedShop === null;
  const kept = `${c.orderCount} 筆訂單先幫你保留。`;
  const others = c.otherShops.length > 0 ? `${c.otherShops.map(n => `「${n}」`).join('、')}的授權已經取消，` : '';
  return {
    reason: system ? SYSTEM_PROBLEM : `「${c.failedShop}」的付款沒有通過：${f.message}`,
    result: `${others}沒有向你的卡片請款。${kept}`,
    cardInvalid: f.cardInvalid,
  };
}
