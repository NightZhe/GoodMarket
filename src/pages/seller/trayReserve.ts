/**
 * 頁面底部要為懸浮托盤預留的高度。--tray-clearance／--stack-clearance（index.css）是以標準托盤高 --tray-h（64）算的；
 * 托盤比標準高（匯入預覽的托盤多一列摘要、可能再多一列「不接續」）時，多出來的高度要補上，否則最後一列會被托盤蓋住。
 * stacked＝托盤疊在分頁膠囊上（水平姿態）。trayHeight＝托盤實測高度（px），還沒量到傳 0。
 */
export function trayReserve(stacked: boolean, trayHeight: number): string {
  return `calc(var(${stacked ? '--stack-clearance' : '--tray-clearance'}) + max(0px, ${trayHeight}px - var(--tray-h)))`;
}
