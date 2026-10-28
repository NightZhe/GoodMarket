import { useCallback, useLayoutEffect, useState } from 'react';
import { isNative } from '../../lib/native/platform';

/** 兩欄的內容寬門檻（design-spec §5.2）：右欄至少約 340，才放得下資訊條三格和兩顆購買鈕。推估，T0 量到後以實測為準 */
export const TWO_COLUMN_MIN_CONTENT = 720;

/** 兩欄時的格線 class（欄界對齊折線：左欄寬＝50vw－中線帶半寬－左內縮，欄距＝中線帶）。只管欄寬與欄距，頂端留白另見 TWO_COLUMN_TOP。商品頁與它的載入骨架共用，載入完不跳版 */
export const TWO_COLUMN_GRID = 'grid-cols-[calc(50vw-var(--midline-half)-var(--inset-l))_minmax(0,1fr)] gap-x-(--midline-band)';

/** 兩欄時內容離頂端的留白（對齊 20）。與 TWO_COLUMN_GRID 同時出現在商品頁與骨架 */
export const TWO_COLUMN_TOP = 'pt-5';

/** 商品頁兩欄規則（Q3）：內容寬 ≥ 720 而且視窗寬 > 高。內容寬＝視窗寬扣掉左右內縮（側邊姿態含軌欄） */
export function isTwoColumn(contentWidth: number, viewport: { width: number; height: number }): boolean {
  return contentWidth >= TWO_COLUMN_MIN_CONTENT && viewport.width > viewport.height;
}

/**
 * 商品頁（含載入骨架）要不要分兩欄。量的是頁面外框元素自己的寬度（已扣掉 .app-shell 的安全區與軌欄），
 * 所以內橫、書本、Split View、iPad 橫向都吃同一條規則，不看機型也不看姿態。
 * 只在 App 內生效：網頁版的桌機版面（md 以上）有自己的兩欄，手機網頁維持單欄。
 * 回傳 [給外框元素的 ref, 是否兩欄]。載入、resize、旋轉都重量；useLayoutEffect 讓第一次繪製前就有答案，不閃。
 */
export function useTwoColumn(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [two, setTwo] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el || !isNative()) return;
    const measure = () => setTwo(isTwoColumn(el.getBoundingClientRect().width, { width: window.innerWidth, height: window.innerHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [el]);

  return [ref, two];
}
