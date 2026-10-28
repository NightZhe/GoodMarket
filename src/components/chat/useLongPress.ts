import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * 長按（設計 3.1）：按住 500ms 觸發；手指移動超過 10px 就取消（那是在捲動）；桌機右鍵（contextmenu）同效。
 * 觸發之後吃掉隨之而來的 click，不會又進了那一列的連結。按下瞬間的底色回饋交給呼叫端的 :active
 */
export function useLongPress(onLongPress: () => void, ms = 500, tolerance = 10) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    origin.current = null;
  }, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { fired.current = true; origin.current = null; onLongPress(); }, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > tolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick: (e: MouseEvent) => { if (fired.current) { e.preventDefault(); fired.current = false; } },
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); clear(); fired.current = true; onLongPress(); },
  };
}
