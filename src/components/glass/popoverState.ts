// 「⋯」浮層的開關狀態（純邏輯，GlassGroup 用）。換頁一律視為關閉，而且是真的清掉：
// 只記「在哪一頁打開的」會在回到同一頁（上一頁、深連結）時自己重新展開。

export type PopoverState = { open: boolean; path: string };

export const popoverAt = (path: string): PopoverState => ({ open: false, path });

/** 路徑變了就回一個新的「已關閉」狀態；沒變回原物件（呼叫端用 === 判斷要不要 setState） */
export function syncPopover(state: PopoverState, pathname: string): PopoverState {
  return state.path === pathname ? state : popoverAt(pathname);
}
