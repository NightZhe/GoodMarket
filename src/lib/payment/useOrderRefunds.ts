import { useCallback, useEffect, useRef, useState } from 'react';
import { toAccountError } from '../account/errors';

// 以訂單編號為鍵的逐單資料（取消申請與退款 get_my_order_refunds／get_shop_order_refunds；撥款狀態 get_seller_order_payouts）。不輪詢：進頁、送出後、回到前景才重讀（介面 8.6）。
// 讀不到時保留上一份資料（畫面不會因為一次失敗就把已知的申請藏起來），state 告訴畫面要不要提示。

/**
 * idle：不讀（沒有線上付款的訂單、開關也關著）；loading：第一次讀；ok；
 * error：讀取失敗，可以重試；missing：資料庫還沒有這支函式（舊資料庫），畫面當作沒有退款功能，不提示
 */
export type RefundsState = 'idle' | 'loading' | 'ok' | 'error' | 'missing';

export function useOrderRefunds<T extends { order_id: string }>(fetcher: () => Promise<T[]>, enabled: boolean) {
  const [state, setState] = useState<{ status: RefundsState; rows: Map<string, T> }>({ status: enabled ? 'loading' : 'idle', rows: new Map() });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) { seq.current++; setState(prev => (prev.status === 'idle' ? prev : { status: 'idle', rows: new Map() })); return; }
    const mine = ++seq.current;
    try {
      const rows = await fetcher();
      if (mine === seq.current) setState({ status: 'ok', rows: new Map(rows.map(r => [r.order_id, r])) });
    } catch (e) {
      if (mine !== seq.current) return;
      setState(prev => ({ status: toAccountError(e).kind === 'backend_missing' ? 'missing' : 'error', rows: prev.rows }));
    }
  }, [enabled, fetcher]);

  useEffect(() => { void reload(); }, [reload]);
  return { rows: state.rows, status: state.status, reload };
}
