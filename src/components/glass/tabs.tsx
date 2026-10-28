import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { CountBadge } from './CountBadge';
import { labelsFit } from './labelFit';

/** 一個分頁。買家 5 格（首頁／逛逛／訂單／我要賣／我的）與賣家 5 格共用同一個型別 */
export type TabItem = {
  to: string;
  /** 顯示的標籤，也是預設的朗讀名稱 */
  label: string;
  /** 朗讀名稱要比標籤多資訊時給（賣家「訂單管理，3 件待出貨」）；沒給就用 label */
  ariaLabel?: string;
  icon: ReactNode;
  /** 選中時的實心版；沒給就用 icon */
  iconActive?: ReactNode;
  /** 右上角數字徽章（aria-hidden；數字要唸就寫進 ariaLabel） */
  badge?: number;
  /** NavLink 的 end：首頁 '/' 要 true，不然所有頁都算「首頁」選中 */
  end?: boolean;
  /** 已經在這一頁時再點一次的動作（例如首頁捲回頂端）；有給才攔截預設導覽 */
  onReselect?: () => void;
};

/** 標籤自然寬度超過格子就回 false（整排改純圖示）。量的是 scrollWidth，標籤藏起來（sr-only）時也量得到，所以字級縮回來時會自己恢復 */
export function useLabelsFit(listRef: RefObject<HTMLElement | null>, available: number): boolean {
  const [fit, setFit] = useState(true);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const labels = Array.from(list.querySelectorAll<HTMLElement>('[data-tab-label]'));
    const measure = () => setFit(labelsFit(labels.map(l => l.scrollWidth), available));
    measure();
    // 字級變大（頁面縮放、文字大小）時標籤自己的尺寸會變，視窗不一定有變
    const ro = new ResizeObserver(measure);
    labels.forEach(l => ro.observe(l));
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [listRef, available]);
  return fit;
}

type CellProps = {
  item: TabItem;
  /** pill＝水平膠囊（60×50，選中有淡橘底）；rail＝直立軌（48×50，選中只換色） */
  kind: 'pill' | 'rail';
  /** 顯示標籤；false＝純圖示（標籤留在 aria-label，視覺上藏起來但仍可量寬度） */
  labeled: boolean;
  /** 軌 L1：純圖示格子矮一點（44） */
  compact?: boolean;
};

const BASE = 'relative flex flex-col items-center justify-center text-caption2 font-medium transition-colors duration-150 active:bg-press-rail active:duration-0 motion-reduce:transition-none';

/** 分頁格：膠囊與直立軌共用。選中態由 NavLink 的 aria-current="page" 帶出 */
export function TabCell({ item, kind, labeled, compact = false }: CellProps) {
  const size = kind === 'pill'
    ? `${labeled ? 'h-(--cell-h) w-[60px]' : 'h-(--cell-h-compact) w-[52px]'} rounded-[25px]`
    : `${labeled && !compact ? 'h-(--cell-h)' : 'h-(--cell-h-compact)'} w-(--rail-cap-w) rounded-[22px]`;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.ariaLabel ?? item.label}
      onClick={item.onReselect && (e => { e.preventDefault(); item.onReselect?.(); })}
      className={({ isActive }) => [
        BASE, size, 'gap-0.5',
        isActive ? 'text-brand' : kind === 'pill' ? 'text-label2-glass' : 'text-muted',
        isActive && kind === 'pill' ? 'bg-tab-sel' : '',
      ].join(' ')}
    >
      {({ isActive }) => (
        <>
          <span aria-hidden="true" className="flex">{isActive && item.iconActive ? item.iconActive : item.icon}</span>
          <span data-tab-label className={labeled ? 'whitespace-nowrap' : 'sr-only'}>{item.label}</span>
          <CountBadge count={item.badge ?? 0} className={kind === 'pill' ? 'left-[calc(50%+5px)] top-[3px]' : 'left-[calc(50%+5px)] top-0.5'} />
        </>
      )}
    </NavLink>
  );
}

/** useLabelsFit 的便利包：回傳掛在容器上的 ref 與「放得下標籤」 */
export function useTabLabels(available: number) {
  const ref = useRef<HTMLElement | null>(null);
  const fit = useLabelsFit(ref, available);
  return { ref, fit };
}
