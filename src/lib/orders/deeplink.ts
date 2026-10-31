// 訂單頁的網址狀態（純函式）：?tab=<分頁> 與 ?order=<訂單 id>。聊聊訂單卡帶訂單 id 直達那筆（決策 D2、D9）
export const TAB_PARAM = 'tab';
export const ORDER_PARAM = 'order';

/** 聊聊訂單卡要連去的網址：訂單頁進頁時 ?order= 優先，找到就切到它目前狀態的分頁並定位（卡片上的「送出時狀態」仍是快照，D3） */
export const orderDeepLink = (ordersPath: '/orders' | '/seller/orders', orderId: string): string =>
  `${ordersPath}?${ORDER_PARAM}=${encodeURIComponent(orderId)}`;

/** 網址 ?tab= 只認分頁清單裡的值；沒有、亂寫、或該分頁此刻不存在（例如待付款分頁還沒出現）都當預設（網址可被任何人亂改） */
export function tabFromQuery<T extends string>(raw: string | null, tabs: readonly T[], fallback: T): T {
  return raw !== null && (tabs as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** 買家訂單目前該在哪個分頁：還沒付完款的線上單在「待付款」（分頁存在時），其餘照訂單狀態 */
export function buyerTabForOrder<S extends string>(status: S, unfinished: boolean, showPendingTab: boolean): S | 'pending' | 'all' {
  if (!unfinished) return status;
  return showPendingTab ? 'pending' : 'all';
}

/** 手動切分頁後的網址：只留 tab，order 拿掉（之後重新整理、返回都停在切過去的分頁） */
export const tabOnlySearch = (tab: string): URLSearchParams => new URLSearchParams({ [TAB_PARAM]: tab });

/**
 * 進頁 ?order= 處理後的網址。找到（tab 有值）→ tab 改成那筆目前的分頁、order 留著（重新整理仍回到同一筆）；
 * 找不到（tab 是 null）→ 拿掉 order、原本的 tab 不動（留在預設或指定的分頁，不白畫面）
 */
export function afterLocate(params: URLSearchParams, tab: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (tab === null) next.delete(ORDER_PARAM);
  else next.set(TAB_PARAM, tab);
  return next;
}

/** 捲到那張卡時對齊哪裡：卡片比視窗矮就置中；展開運送進度後比視窗高的卡置中會切掉頂端，改對齊頂端（配合 scroll-margin 避開釘住的分頁列） */
export const scrollBlockFor = (cardHeight: number, viewportHeight: number): ScrollLogicalPosition =>
  cardHeight > viewportHeight * 0.8 ? 'start' : 'center';
