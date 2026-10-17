import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAccountReviewStatus, getReviewSummary } from '../lib/reviews/api';
import type { OrderReviewStatus, RatingStat, ReviewSummaryData } from '../lib/reviews/types';
import { useStore } from './StoreContext';

// 評價的全站資料：
//  - summary：每件商品、每家店的 {count, avg}，一次取回（資料庫算好，賣家改不到）。
//    前台所有顯示評分的地方都讀這裡，不再讀 products.rating、shops.rating。
//  - status：目前登入的帳號每張已完成訂單的評價狀態（期限、哪些商品評過了）。
// 兩者都保留「上一次的資料」：重新取得期間不閃畫面，失敗時舊資料仍可用。

export type LoadState = 'loading' | 'ready' | 'error';

interface Ctx {
  summaryState: LoadState;
  productStat: (productId: string) => RatingStat | undefined;
  shopStat: (shopId: string) => RatingStat | undefined;
  refreshSummary: () => Promise<void>;

  statusState: LoadState;
  statusList: OrderReviewStatus[];
  statusOf: (orderId: string) => OrderReviewStatus | undefined;
  /**
   * 回傳 true＝取得成功。重新取得期間舊資料會留著，不會先清空。
   * silent：背景自動重新整理用，失敗時不把畫面變成錯誤狀態（舊資料繼續可用）。
   */
  refreshStatus: (silent?: boolean) => Promise<boolean>;
}

const ReviewsCtx = createContext<Ctx | null>(null);

export function ReviewsProvider({ children }: { children: ReactNode }) {
  const { user } = useStore();
  const userId = user?.id ?? null;

  const [summary, setSummary] = useState<ReviewSummaryData | null>(null);
  const [summaryState, setSummaryState] = useState<LoadState>('loading');
  const summarySeq = useRef(0);

  const refreshSummary = useCallback(async () => {
    const seq = ++summarySeq.current;
    try {
      const data = await getReviewSummary();
      if (seq !== summarySeq.current) return;
      setSummary(data);
      setSummaryState('ready');
    } catch {
      if (seq !== summarySeq.current) return;
      // 有舊資料就繼續用舊的；沒有才算失敗（畫面上「不顯示評分」，不會假裝是「尚無評價」）
      setSummaryState(prev => (prev === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  useEffect(() => { void refreshSummary(); }, [refreshSummary]);

  const [statusList, setStatusList] = useState<OrderReviewStatus[]>([]);
  const [statusState, setStatusState] = useState<LoadState>('ready');
  const statusSeq = useRef(0);

  const refreshStatus = useCallback(async (silent = false) => {
    const seq = ++statusSeq.current;
    if (!silent) setStatusState(prev => (prev === 'error' ? 'loading' : prev));
    // 沒登入就沒有訂單，也不呼叫資料庫（遊客瀏覽不碰帳號版的結構）
    if (!userId) {
      setStatusList([]);
      setStatusState('ready');
      return true;
    }
    try {
      const data = await getAccountReviewStatus();
      if (seq !== statusSeq.current) return true;
      setStatusList(data);
      setStatusState('ready');
      return true;
    } catch {
      if (seq !== statusSeq.current) return false;
      if (!silent) setStatusState('error');
      return false;
    }
  }, [userId]);

  // 登入、登出、換帳號：先清掉上一個帳號的資料（不能讓下一個人看到），再重新取得
  useEffect(() => {
    setStatusList([]);
    setStatusState(userId ? 'loading' : 'ready');
    void refreshStatus();
  }, [userId, refreshStatus]);

  const value = useMemo<Ctx>(() => ({
    summaryState,
    productStat: id => summary?.products[id],
    shopStat: id => summary?.shops[id],
    refreshSummary,
    statusState,
    statusList,
    statusOf: id => statusList.find(s => s.order_id === id),
    refreshStatus,
  }), [summary, summaryState, refreshSummary, statusState, statusList, refreshStatus]);

  return <ReviewsCtx.Provider value={value}>{children}</ReviewsCtx.Provider>;
}

export function useReviews() {
  const c = useContext(ReviewsCtx);
  if (!c) throw new Error('useReviews 必須在 ReviewsProvider 內使用');
  return c;
}

/**
 * 回到前景時靜默重新取得（背景放太久，期限可能剛好跨過 23:59）。
 * onFocus：桌面上只切換視窗不會觸發 visibilitychange，需要時一併聽 window 的 focus。
 * 兩個事件常同時發生，呼叫端自己負責去重。
 */
export function useRefreshOnVisible(fn: () => void, { onFocus = false }: { onFocus?: boolean } = {}) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') ref.current(); };
    document.addEventListener('visibilitychange', onVisible);
    if (onFocus) window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (onFocus) window.removeEventListener('focus', onVisible);
    };
  }, [onFocus]);
}
