import type { ReactNode } from 'react';
import { GlassTray } from '../../components/glass';
import { usePosture } from '../../lib/layout/posture';
import { TRAY_DIMMED, TRAY_RIGHT_HALF } from '../../lib/layout/trayPlacement';
import { useTrayHeightReport } from '../../lib/layout/trayReserve';

/**
 * 水平姿態（直向）托盤疊在分頁膠囊正上方；側邊姿態沒有膠囊，托盤落在右半（D13）。
 * 頁面用它決定內容底部預留（--stack-clearance 或 --tray-clearance，見 lib/layout/trayReserve.ts）。
 */
export function useStackedTray(): boolean {
  return usePosture() === 'bottom';
}

/**
 * 賣家頁底部的懸浮托盤外殼（新增／編輯商品的儲存、匯入預覽的開始匯入共用）：只在手機出現（桌機網頁 md 以上用頁底的 sticky 列）、
 * 按鈕被擋下時的底色、側邊姿態落在右半，都在這裡。內容（TrayButton 們）由呼叫端放。
 * onHeight：托盤高度會隨內容變（匯入預覽有摘要列），要預留精確高度的頁面傳這個，托盤尺寸改變時會再報一次。
 */
export function SellerTray({ label, children, onHeight }: { label: string; children: ReactNode; onHeight?: (height: number) => void }) {
  const stacked = useStackedTray();
  const wrapRef = useTrayHeightReport(h => onHeight?.(h));
  return (
    <div ref={wrapRef} className={`md:hidden ${TRAY_DIMMED} ${stacked ? '' : TRAY_RIGHT_HALF}`}>
      <GlassTray label={label} abovePill={stacked}>{children}</GlassTray>
    </div>
  );
}
