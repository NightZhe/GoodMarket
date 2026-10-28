import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 量元素目前的寬度（ResizeObserver；字級、縮放、旋轉變了它自己會更新）。量到之前回 Infinity（呼叫端當作「放得下」），layout effect 在繪製前就會改。
 * 元素從 DOM 拿掉後再掛上時，ref 換了也會重量：依賴 ref.current 的存在，所以呼叫端用 active 控制。
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, active = true): number {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return width;
}
