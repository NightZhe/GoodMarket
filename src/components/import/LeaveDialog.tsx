import { useEffect, useRef } from 'react';
import { btnDangerText, btnPrimary } from './ui';

interface Props {
  /** 已寫入的商品件數，寫在說明裡讓賣家知道沒有白做 */
  written: number;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * 離開確認（F-3.8、AC-78）。初始焦點與主按鈕是「留在這裡」（安全選項）；
 * Esc 等於留在這裡；Tab 只在兩顆按鈕之間循環；關閉後焦點還給原本的元素。
 */
export default function LeaveDialog({ written, onStay, onLeave }: Props) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onStay(); return; }
    if (e.key !== 'Tab') return;
    const first = stayRef.current;
    const last = leaveRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-desc"
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-popover"
      >
        <h2 id="leave-title" className="text-lg font-bold">要離開嗎？匯入還沒完成</h2>
        <p id="leave-desc" className="mt-2 text-sm text-muted">
          現在離開會中斷匯入。已經寫入的 {written.toLocaleString('en-US')} 件商品會保留；沒做完的部分，之後再匯入同一批檔案就會接著完成。
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <button ref={leaveRef} type="button" onClick={onLeave} className={btnDangerText}>離開並中斷</button>
          <button ref={stayRef} type="button" onClick={onStay} className={btnPrimary}>留在這裡</button>
        </div>
      </div>
    </div>
  );
}
