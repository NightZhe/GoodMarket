import { useSyncExternalStore } from 'react';

// 直立軌的工具組（上）與分頁組（下）是兩個各自掛在 DOM 該在位置的元件（朗讀順序），但分頁組要知道工具組佔了多高才算得出可用高度。
// 工具組量完自己的高度報在這裡，分頁組訂閱。一個畫面同一時間只有一組工具、一組分頁（買家與賣家外框各自只掛一份），所以用單一數字就夠。
let toolsHeight = 0;
const listeners = new Set<() => void>();

/** 工具組回報自己的高度（px）；卸載時回報 0（沒有工具組的頁，分頁組可以用滿整段） */
export function reportRailTools(height: number): void {
  if (height === toolsHeight) return;
  toolsHeight = height;
  listeners.forEach(l => l());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** 目前工具組的高度；沒有工具組＝0 */
export function useRailToolsHeight(): number {
  return useSyncExternalStore(subscribe, () => toolsHeight, () => 0);
}
