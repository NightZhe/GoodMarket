import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

// 手機登入畫面共用的 class 與小元件（class 字串逐字來自 design/proto/kit.mjs，只用 index.css 現有 token）。
// 跟 import/ui.ts 的 btnPrimary 不同處：送出中維持品牌橘（不用 bg-disabled），按下有 150ms 縮放（減少動態時關掉）。

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-sm px-4 text-sm font-medium ${FOCUS} transition-transform duration-150 motion-safe:active:scale-[0.98]`;
export const PRIMARY = `${BTN} bg-brand text-white hover:bg-brand-dark aria-busy:cursor-wait aria-busy:hover:bg-brand aria-disabled:cursor-not-allowed aria-disabled:hover:bg-brand`;
export const OUTLINE = `${BTN} border border-line bg-white text-ink hover:bg-canvas aria-disabled:cursor-not-allowed aria-disabled:text-muted`;
export const LINK = `inline-flex min-h-11 items-center gap-1 text-sm text-ink underline underline-offset-2 ${FOCUS}`;
export const LABEL = 'block text-sm font-medium';
export const INPUT = 'block h-12 w-full rounded-sm border border-muted bg-white px-3 text-base text-ink outline-none placeholder:text-muted focus:border-ink focus:outline focus:outline-1 focus:-outline-offset-1 focus:outline-ink read-only:bg-subtle';
export const INPUT_ERR = 'border-error-text! focus:border-error-text! focus:outline-error-text!';
export const HELP = 'mt-1 text-sm text-muted';
export const FOCUS_RING = FOCUS;

/** 欄位下方的錯誤句：圖示＋文字（顏色以外還有圖示，不只靠紅色） */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 text-sm text-error-text">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{children}</span>
    </p>
  );
}
