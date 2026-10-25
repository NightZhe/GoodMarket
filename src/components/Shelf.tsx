import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/**
 * 橫滑貨架：原生捲動＋snap，子項自己負責 `shrink-0` 與 `snap-start`（`ProductCard variant="shelf"` 已有）。
 * 上下各留 4（py-1，-my-1 抵銷，版面不變）：焦點框 2px＋offset 2px 才不會被 overflow 裁掉
 */
export default function Shelf({ children, ariaLabel, className = '' }: Props) {
  return (
    <div
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      className={`no-scrollbar flex snap-x snap-mandatory scroll-px-5 gap-3 -my-1 overflow-x-auto px-5 py-1 ${className}`}
    >
      {children}
    </div>
  );
}
