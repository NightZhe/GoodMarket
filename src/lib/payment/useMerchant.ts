import { useEffect, useState } from 'react';
import { fetchMyMerchant } from './api';
import { useRefreshOnVisible } from '../../store/ReviewsContext';
import { merchantStateOf, type MerchantState } from './merchant';

/**
 * 自己店的收款狀態（帳號頁「收款帳戶」列右側、賣場總覽的提示卡用）。
 * null＝還沒讀到或讀不到：呼叫端不顯示狀態，不顯示「載入中」也不顯示錯誤（賣家今天沒有要處理的事）。
 * enabled＝false（功能開關關著、沒有開店）時完全不讀。
 */
export function useMerchantState(enabled: boolean): MerchantState | null {
  const [state, setState] = useState<MerchantState | null>(null);
  const load = () => { fetchMyMerchant().then(row => setState(merchantStateOf(row)), () => undefined); };
  useEffect(() => { if (enabled) load(); else setState(null); }, [enabled]);
  useRefreshOnVisible(() => { if (enabled) load(); });
  return state;
}
