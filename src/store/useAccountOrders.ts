import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelAccountOrder, completeAccountOrder, getAccountOrders } from '../lib/account/api';
import { toAccountError, type AccountErrorKind } from '../lib/account/errors';
import { toOrder } from '../lib/orders/map';
import type { Order } from '../types';

// 帳號版「我的訂單」（D1、D16）：一律先登入，只看得到自己帳號的訂單，換裝置登入也看得到。
// 沒有登入時完全不呼叫資料庫（遊客瀏覽不碰任何新結構，缺 M1 的資料庫也不受影響）。

export type OrdersState = 'idle' | 'loading' | 'ready' | 'error';

export function useAccountOrders(userId: string | null, onAuthLost: () => void) {
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [myOrdersState, setState] = useState<OrdersState>('idle');
  const [myOrdersIssue, setIssue] = useState<AccountErrorKind | null>(null);
  const seq = useRef(0);

  /** silent：背景重讀，失敗時保留舊畫面，不把整頁變成錯誤 */
  const refreshMyOrders = useCallback(async (silent = false): Promise<boolean> => {
    const s = ++seq.current;
    if (!userId) {
      setMyOrders([]);
      setState('idle');
      return true;
    }
    if (!silent) setState(p => (p === 'ready' ? 'ready' : 'loading'));
    try {
      const rows = await getAccountOrders();
      if (s !== seq.current) return true;
      setMyOrders(rows.map(toOrder));
      setState('ready');
      setIssue(null);
      return true;
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') onAuthLost();
      if (s !== seq.current) return false;
      setIssue(err.kind);
      setState(p => (silent && p === 'ready' ? 'ready' : 'error'));
      return false;
    }
  }, [userId, onAuthLost]);

  useEffect(() => { void refreshMyOrders(); }, [refreshMyOrders]);

  /** 取消、完成：狀態不符時資料庫會回 ORDER_STATE_CHANGED（不再靜默成功），錯誤往上丟給畫面 toast，並先重讀讓畫面追上 */
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') onAuthLost();
      else if (err.kind === 'server') void refreshMyOrders(true);
      throw err;
    }
    await refreshMyOrders(true);
  }, [refreshMyOrders, onAuthLost]);

  const cancelMyOrder = useCallback((id: string) => act(() => cancelAccountOrder(id)), [act]);
  const completeMyOrder = useCallback((id: string) => act(() => completeAccountOrder(id)), [act]);

  return { myOrders, myOrdersState, myOrdersIssue, refreshMyOrders, cancelMyOrder, completeMyOrder };
}
