import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** 橫滑貨架：原生捲動＋snap，子項自己負責 `shrink-0` 與 `snap-start`（`ProductCard variant="shelf"` 已有） */
export default function Shelf({ children, ariaLabel, className = '' }: Props) {
  return (
    <div
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      className={`no-scrollbar flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 ${className}`}
    >
      {children}
    </div>
  );
}
