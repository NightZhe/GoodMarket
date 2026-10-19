export type PaymentGate = 'wait' | 'allow' | 'redirect';

/** 付款方式、新增信用卡、綁卡結果、收款帳戶頁的閘門：開關沒答案先等；關著（或讀不到）導回；打開才放行 */
export const paymentGate = ({ enabled, ready }: { enabled: boolean; ready: boolean }): PaymentGate =>
  !ready ? 'wait' : enabled ? 'allow' : 'redirect';
