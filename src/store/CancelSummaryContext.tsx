import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from './StoreContext';
import { useRefreshOnVisible } from './ReviewsContext';
import { fetchShopCancelSummary } from '../lib/payment/api';
import { usePaymentConfig } from '../lib/payment/usePaymentConfig';
import type { ShopCancelSummary } from '../lib/payment/types';

// 賣家中心「取消申請 N」的共用來源（退款設計 6.1）：SellerLayout 讀一次，側欄、底欄、賣場總覽、訂單頁共用。
// 用輕量 RPC get_shop_cancel_summary（只回申請中筆數與最早回應期限），不從 shopOrders 推（賣家讀不到 payment_status，申請資料在 RPC 裡）。
// 重讀時機：進賣家中心、路由切換、回到前景（visibilitychange／pageshow persisted）、賣家自己回應之後。不輪詢。
// 讀取中或讀失敗＝null：什麼都不顯示（不顯示 0、不顯示「–」）——這個提示是「有事要做」的訊號，沒有訊號等於沒事；訂單頁自己有讀失敗橫幅。

interface Value { summary: ShopCancelSummary | null; reload: () => Promise<void> }

const Ctx = createContext<Value>({ summary: null, reload: async () => {} });

export function CancelSummaryProvider({ children }: { children: ReactNode }) {
  const { shopOrders } = useStore();
  const { enabled } = usePaymentConfig();
  const { pathname } = useLocation();
  const [summary, setSummary] = useState<ShopCancelSummary | null>(null);
  // 沒有線上付款訂單、開關也關著：不問（舊資料庫沒有這支函式，畫面與上線前逐字相同）
  const wanted = enabled || shopOrders.some(o => o.payment === 'ecpay_card');
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    if (!wanted) { setSummary(null); return; }
    try {
      const next = await fetchShopCancelSummary();
      if (mine === seq.current) setSummary(prev => (prev && prev.pending === next.pending && prev.earliestRespondBy === next.earliestRespondBy ? prev : next));
    } catch {
      if (mine === seq.current) setSummary(null);
    }
  }, [wanted]);

  useEffect(() => { void reload(); }, [reload, pathname]);
  useRefreshOnVisible(() => { void reload(); });
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void reload(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reload]);

  const value = useMemo(() => ({ summary, reload }), [summary, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCancelSummary = () => useContext(Ctx);

/** 申請中的筆數；讀取中、讀失敗、沒有申請都是 0 */
export const pendingCount = (s: ShopCancelSummary | null): number => s?.pending ?? 0;
