/**
 * 直立軌分頁組的層級（design-spec §3.2.3、decisions X3）：
 *   L0＝圖示＋標籤（每格 56×50）｜L1＝純圖示（每格 56×44，標籤留在 aria-label）｜L2＝收成一顆 56×56「目前分頁」鈕，點開展開成 L1 浮層。
 * 只縮分頁組，工具組（返回、購物車、分享）永不壓縮；沒有「…」選單。
 */
export type RailLevel = 'L0' | 'L1' | 'L2';

/** 軌的工具組與分頁組之間至少留的空白 */
export const RAIL_GAP = 12;

const PAD = 12; // 膠囊上下內距各 6
const CELL = { L0: 50, L1: 44 } as const;
const L2_BUTTON = 56;

/** 分頁組在該層級的高度 */
export function railGroupHeight(level: RailLevel, count: number): number {
  return level === 'L2' ? L2_BUTTON : PAD + count * CELL[level];
}

/**
 * 取第一個放得下的層級（執行時依實際高度算，不寫死在頁面上）。
 * available＝分頁組可用高度（軌的區間扣掉工具組與 RAIL_GAP）。labelsFit＝false（文字放大、標籤放不下 56 欄寬）時跳過 L0。
 * 連 L2 都放不下就維持 L2：軌不會消失，也不出現別的東西。
 */
export function pickRailLevel({ available, count, labelsFit }: { available: number; count: number; labelsFit: boolean }): RailLevel {
  if (labelsFit && available >= railGroupHeight('L0', count)) return 'L0';
  if (available >= railGroupHeight('L1', count)) return 'L1';
  return 'L2';
}
