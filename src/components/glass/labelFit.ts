/**
 * 膠囊與直立軌的標籤是否放得進格子。widths＝每個標籤的自然寬度（scrollWidth），available＝格子扣掉左右留白後的寬。
 * 任何一個放不下，整排一起改純圖示（標籤留在 aria-label），不允許有的有字有的沒字。
 */
export function labelsFit(widths: readonly number[], available: number): boolean {
  return widths.every(w => w <= available);
}
