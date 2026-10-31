import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ORDER_PARAM, TAB_PARAM, afterLocate, scrollBlockFor, tabFromQuery, tabOnlySearch } from './deeplink';

/** 訂單卡片的 DOM id：進頁 ?order= 時用它捲到那張卡 */
export const orderCardDomId = (orderId: string): string => `order-card-${orderId}`;

/** 卡片高亮多久（邊框色），之後交給 transition 淡出 */
const HIGHLIGHT_MS = 2000;
/** 平滑捲動到位的確認時間（平滑捲動最長約一秒） */
const SCROLL_CHECK_MS = 1000;

const scrollToCard = (el: HTMLElement, smooth: boolean) =>
  el.scrollIntoView({ block: scrollBlockFor(el.getBoundingClientRect().height, window.innerHeight), behavior: smooth ? 'smooth' : 'auto' });

/** 卡片有沒有捲到位：頂端在視窗上半部（置中或對齊頂端都成立） */
const cardInView = (el: HTMLElement): boolean => {
  const { top } = el.getBoundingClientRect();
  return top >= 0 && top <= window.innerHeight * 0.6;
};

interface Options<T extends string> {
  /** 此刻存在的分頁（買家的待付款分頁是動態的） */
  tabs: readonly T[];
  fallback: T;
  /** 訂單清單讀好了才能下「找不到」的結論；沒讀好前 ?order= 先等 */
  loaded: boolean;
  /** 該筆訂單目前該在哪個分頁；不屬於這個帳號或已刪時回 null */
  locate: (orderId: string) => T | null;
  /** 找到了：展開那筆（既有的 setOpenId） */
  onFound: (orderId: string) => void;
  /** 找不到：既有 Toast 提示 */
  onMissing: () => void;
}

/**
 * 訂單頁的分頁與網址同步（決策 D9）：
 * - 分頁來自 ?tab=，重新整理與返回都留在同一分頁；切分頁用 replace 寫回，並拿掉 ?order=
 * - 進頁 ?order=<id> 優先：清單讀好後找到該筆 → 切到它目前狀態的分頁、捲到那張卡、展開、短暫高亮；
 *   找不到 → 留在原分頁、提示找不到，網址拿掉 order
 */
export function useOrderDeepLink<T extends string>({ tabs, fallback, loaded, locate, onFound, onMissing }: Options<T>) {
  const [params, setParams] = useSearchParams();
  const tab = tabFromQuery(params.get(TAB_PARAM), tabs, fallback);
  const orderId = params.get(ORDER_PARAM);
  // 定位中的那筆與它該在的分頁：分頁真的切過去（網址寫回、重新 render）之後才捲，否則會捲到它在舊分頁清單裡的位置
  const [target, setTarget] = useState<{ id: string; tab: T } | null>(null);
  // 同一個 ?order= 只處理一次：之後清單重讀（回到前景、出貨後）不會再捲一次；order 從網址拿掉後重設
  const handled = useRef<string | null>(null);

  const selectTab = (next: T) => setParams(tabOnlySearch(next), { replace: true });

  useEffect(() => {
    if (!orderId) { handled.current = null; return; }
    if (!loaded || handled.current === orderId) return;
    handled.current = orderId;
    const tabOfOrder = locate(orderId);
    setParams(afterLocate(params, tabOfOrder), { replace: true });
    if (tabOfOrder === null) { onMissing(); return; }
    setTarget({ id: orderId, tab: tabOfOrder });
    onFound(orderId);
  }, [orderId, loaded, locate, onFound, onMissing, params, setParams]);

  // 分頁已經是那筆該在的分頁、那筆也展開了，卡片才在畫面上：這時捲過去並開始計時高亮
  useEffect(() => {
    if (!target || tab !== target.tab) return;
    const el = document.getElementById(orderCardDomId(target.id));
    const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => setTarget(null), HIGHLIGHT_MS)];
    if (el && typeof el.scrollIntoView === 'function') {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      scrollToCard(el, !reduced);
      // 瀏覽器可能把這次平滑捲動丟掉（重新整理後第一次改網址時實測發生過）：一秒後確認有沒有到位，沒到就不帶動畫直接跳過去
      timers.push(setTimeout(() => { if (!cardInView(el)) scrollToCard(el, false); }, SCROLL_CHECK_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [target, tab]);

  return { tab, selectTab, highlightId: target?.id ?? null };
}
