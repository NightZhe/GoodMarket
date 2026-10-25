import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { currentNavKind, recordNavigation } from '../lib/ui/navKind';

/**
 * 換頁（路徑變動）捲回頂端。例外：返回（瀏覽器上一頁或 iOS 邊緣滑回）不捲，
 * 留給瀏覽器與列表自己還原位置（見 useInfiniteReveal）。
 * 首次載入與重新整理雖然也是 POP，但不是返回（見 navKind），照一般換頁處理。
 * 同時負責登記「這份文件已經導覽過」，這個登記要在子頁面 render 之後才發生，所以放在 effect
 */
export default function ScrollToTop() {
  const { pathname, key } = useLocation();
  const navType = useNavigationType();
  const back = currentNavKind(navType) === 'back';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!back) window.scrollTo(0, 0); }, [pathname]); // back 只在路徑變動那一刻讀
  // navType 只在換導覽那一刻讀
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recordNavigation(navType); }, [key]);
  return null;
}
