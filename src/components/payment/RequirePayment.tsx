import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { paymentGate } from '../../lib/payment/gate';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';

/**
 * 線上付款開關關著（或讀不到）時，付款方式、新增信用卡、綁卡結果、收款帳戶這幾頁直接輸入網址也不能進：導回 to。
 * 開關還沒有答案時先放一個靜態的載入畫面，不閃出內容、也不先打任何付款相關的請求
 */
export default function RequirePayment({ to, children }: { to: string; children: ReactNode }) {
  const gate = paymentGate(usePaymentConfig());
  if (gate === 'wait') {
    return (
      <div role="status" aria-busy="true" className="flex min-h-64 items-center justify-center text-sm text-muted">載入中…</div>
    );
  }
  return gate === 'allow' ? <>{children}</> : <Navigate to={to} replace />;
}
