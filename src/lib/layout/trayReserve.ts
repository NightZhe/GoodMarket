import { useCallback, useRef, type CSSProperties } from 'react';

/**
 * 頁面底部要為懸浮托盤預留的高度。--tray-clearance／--stack-clearance（index.css）是以標準托盤高 --tray-h（64）算的；
 * 托盤比標準高（匯入預覽的托盤多一列摘要；文字放大到 200% 時按鈕換行上下排）時，多出來的高度要補上，否則最後一列會被托盤蓋住。
 * stacked＝托盤疊在分頁膠囊上（水平姿態）。trayHeight＝托盤實測高度（px），還沒量到傳 0。
 */
export function trayReserve(stacked: boolean, trayHeight: number): string {
  return `calc(var(${stacked ? '--stack-clearance' : '--tray-clearance'}) + max(0px, ${trayHeight}px - var(--tray-h)))`;
}

/** 頁面根元素的 inline style：把 trayReserve 的結果放進 --tray-reserve，根元素再用 pb-(--tray-reserve)。買家的托盤沒有疊在膠囊上，stacked＝false */
export function trayReserveStyle(stacked: boolean, trayHeight: number): CSSProperties {
  return { '--tray-reserve': trayReserve(stacked, trayHeight) } as CSSProperties;
}

/**
 * 量托盤高度並回報：callback ref 掛在托盤的外層包裝（第一個子元素是 GlassTray），托盤尺寸變了（文字放大、換行、多一列）會再報一次。
 * 包裝被隱藏（display:none，例如桌機版面）時量到 0，預留自然退回標準值；包裝卸下時回報 0。
 * 用 callback ref 而不是 useLayoutEffect：包裝可能晚一點才掛上（條件渲染），掛上的當下才開始量。
 */
export function useTrayHeightReport(onHeight: (height: number) => void): (wrap: HTMLElement | null) => void {
  const reportRef = useRef(onHeight);
  reportRef.current = onHeight;
  const observerRef = useRef<ResizeObserver | null>(null);
  return useCallback((wrap: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const tray = wrap?.firstElementChild;
    if (!tray) { reportRef.current(0); return; }
    const report = () => reportRef.current(Math.ceil(tray.getBoundingClientRect().height));
    report();
    observerRef.current = new ResizeObserver(report);
    observerRef.current.observe(tray);
  }, []);
}
