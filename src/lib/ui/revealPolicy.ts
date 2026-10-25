/**
 * 無限捲動的「揭露規則」：列表一批畫幾件、返回時還原幾件、要不要顯示「回到頂端」、記憶 key。
 * 純函式，不碰 DOM 與 sessionStorage（讀寫由 useInfiniteReveal 做）。
 */

/** 每批件數。首頁格子手機 2 欄、桌機 4／6 欄都整除；逛逛桌機 5 欄不整除，接受最後一列不滿 */
export const REVEAL_BATCH = 24;

/** 導覽種類：back＝瀏覽器上一頁／iOS 邊緣滑回（react-router 的 POP）；go＝其餘（PUSH／REPLACE） */
export type RevealNav = 'back' | 'go';

/** 下一批：已畫件數加一批，不超過總件數 */
export function nextShown(total: number, shown: number): number {
  return Math.min(total, shown + REVEAL_BATCH);
}

/** 首次畫幾件：返回且有記憶 → 記憶值（至少一批、不超過總件數）；其他 → 一批 */
export function initialShown(total: number, nav: RevealNav, remembered: number | undefined): number {
  const want = nav === 'back' && remembered !== undefined ? Math.max(remembered, REVEAL_BATCH) : REVEAL_BATCH;
  return Math.min(total, want);
}

/** 無限捲動的狀態：loc＝這份狀態屬於哪一次導覽（location.key），want＝想畫幾件（不截到總件數） */
export interface RevealState { loc: string; want: number }

/**
 * 導覽（location.key）變了才重置：返回 → 以記憶還原；前往（含逛逛再送出同樣的關鍵字、換篩選）→ 第一批。
 * 記憶 key 只負責索引記憶，是否重置看的是導覽，所以記憶 key 沒變也會回第一批。導覽沒變就原物件回傳
 */
export function syncReveal(state: RevealState, loc: string, nav: RevealNav, remembered: number | undefined): RevealState {
  if (state.loc === loc) return state;
  return { loc, want: initialShown(Infinity, nav, remembered) };
}

/** 還有沒有下一批 */
export function hasMore(total: number, shown: number): boolean {
  return shown < total;
}

/** 「回到頂端」：畫到最後一件，而且總件數超過一批（短列表不放，D-1） */
export function showBackToTop(total: number, shown: number): boolean {
  return shown >= total && total > REVEAL_BATCH;
}

/** 首頁「全部商品」的記憶 key */
export const HOME_REVEAL_KEY = 'reveal:home';

/**
 * 逛逛的記憶 key：關鍵字、分類、排序、免運四個條件，順序固定、空值正規化。
 * 任一條件變動就是另一個 key，等於換條件回第一批。排序「綜合」是預設值，與沒指定相同
 */
export function browseRevealKey(c: { q?: string; cat?: string; sort?: string; free?: boolean }): string {
  const sort = c.sort && c.sort !== 'relevance' ? c.sort : '';
  const parts = [
    ['q', (c.q ?? '').trim()],
    ['cat', c.cat ?? ''],
    ['sort', sort],
    ['free', c.free ? '1' : ''],
  ];
  return `reveal:browse:${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
