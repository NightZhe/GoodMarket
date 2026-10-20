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
 * 二選一確認對話框（匯入的離開確認 F-3.8、AC-78，與評價的送出前／離開確認共用）。
 * 初始焦點與 Esc 都是 stay（安全選項）；Tab 只在兩顆按鈕之間循環；關閉後焦點還給原本的元素。
 */
export default function LeaveDialog({
  title, description, stayLabel, leaveLabel, leaveTone = 'danger', busy = false, busyLabel, offlineNotice, onStay, onLeave,
}: Props) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onStay(); return; }
    if (e.key !== 'Tab') return;
    const first = stayRef.current;
    const last = leaveRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const primary = leaveTone === 'primary';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-desc"
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-popover"
      >
        <h2 id="leave-title" className="text-lg font-bold">{title}</h2>
        <div id="leave-desc" className="mt-2 text-sm text-muted">{description}</div>
        {offlineNotice && <p role="status" className="mt-4 text-sm text-muted">{offlineNotice}</p>}
        <div className={`${offlineNotice ? 'mt-2' : 'mt-5'} flex flex-col-reverse gap-2 md:flex-row md:justify-end`}>
          <button
            ref={leaveRef} type="button" aria-disabled={busy || offlineNotice !== undefined || undefined}
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
