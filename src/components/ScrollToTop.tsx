import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 換頁（路徑變動）捲回頂端。例外：返回（POP，瀏覽器上一頁或 iOS 邊緣滑回）不捲，
 * 留給瀏覽器與列表自己還原位置（見 useInfiniteReveal）
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => { if (navType !== 'POP') window.scrollTo(0, 0); }, [pathname]); // navType 只在路徑變動那一刻讀
  return null;
}
