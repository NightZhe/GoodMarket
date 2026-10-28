import { useEffect, useRef, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { btnDangerText, btnOutline, btnPrimary } from './ui';

interface Props {
  title: string;
  description: ReactNode;
  /** 安全選項（初始焦點；Esc 等於它） */
  stayLabel: string;
  /** 另一個選項 */
  leaveLabel: string;
  /**
   * leave 按鈕的樣子。'danger'（預設）：離開類，安全選項是主按鈕；
   * 'primary'：確認類（例如「確定送出」），安全選項是次要按鈕。
   */
  leaveTone?: 'danger' | 'primary';
  /** 處理中：兩顆按鈕都不能按、Esc 無效，leave 按鈕顯示 busyLabel（擋雙擊） */
  busy?: boolean;
  busyLabel?: string;
  /**
   * 離線時的一行說明（role="status"，放在按鈕列上方）。有值＝目前不能送出：leave 按鈕 aria-disabled；
   * 安全選項（stay）永遠能按，離線時也要能關掉對話框
   */
  offlineNotice?: string;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * Tab 循環：焦點在最後一顆按 Tab → 第一顆；在第一顆按 Shift+Tab → 最後一顆；焦點已在對話框外則拉回（Tab→第一顆、Shift+Tab→最後一顆）。
 * 其餘情況回 null，交給瀏覽器。items 必須是 DOM 順序（Tab 就是照這個順序走）
 */
export function tabWrapTarget<T>(items: T[], active: unknown, shiftKey: boolean): T | null {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return null;
  const at = items.indexOf(active as T);
  if (shiftKey) return at === -1 || at === 0 ? last : null;
  return at === -1 || at === items.length - 1 ? first : null;
}

/**
 * 二選一確認對話框（匯入的離開確認 F-3.8、AC-78，與評價的送出前／離開確認共用）。
 * 初始焦點與 Esc 都是 stay（安全選項）；Tab 只在兩顆按鈕之間循環（頭尾看 DOM 順序）；關閉後焦點還給原本的元素。
 */
export default function LeaveDialog({
  title, description, stayLabel, leaveLabel, leaveTone = 'danger', busy = false, busyLabel, offlineNotice, onStay, onLeave,
}: Props) {
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onStay(); return; }
    if (e.key !== 'Tab') return;
    // 頭尾以 DOM 順序為準（leave 在前、stay 在後），不是以「哪顆是安全選項」為準
    const target = tabWrapTarget([...e.currentTarget.querySelectorAll('button')], document.activeElement, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); }
  };

  const primary = leaveTone === 'primary';

  return (
    // 容器吃四邊安全區、面板避開中線帶（.fold-dialog／.fold-panel，D13）：一般姿態靠下，內橫／書本落右半；桌機網頁維持置中
    <div className="fold-dialog fixed inset-0 z-50 items-end md:items-center md:p-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-desc"
        className="fold-panel relative max-w-md rounded-lg bg-white p-6 shadow-popover md:mx-0 md:w-full md:max-h-none"
      >
        <h2 id="leave-title" className="text-lg font-bold">{title}</h2>
        <div id="leave-desc" className="mt-2 text-sm text-muted">{description}</div>
        {offlineNotice && <p role="status" className="mt-4 text-sm text-muted">{offlineNotice}</p>}
        <div className={`${offlineNotice ? 'mt-2' : 'mt-5'} flex flex-col-reverse gap-2 md:flex-row md:justify-end`}>
          <button
            type="button" aria-disabled={busy || offlineNotice !== undefined || undefined}
            onClick={busy || offlineNotice !== undefined ? undefined : onLeave}
            className={primary ? btnPrimary : btnDangerText}
          >
            {busy && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
            {busy ? (busyLabel ?? leaveLabel) : leaveLabel}
          </button>
          <button
            ref={stayRef} type="button" aria-disabled={busy || undefined}
            onClick={busy ? undefined : onStay}
            className={primary ? btnOutline : btnPrimary}
          >
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
