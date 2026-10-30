import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 量元素目前的寬度（ResizeObserver；字級、縮放、旋轉變了它自己會更新）。量到之前回 Infinity（呼叫端當作「放得下」），layout effect 在繪製前就會改。
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
