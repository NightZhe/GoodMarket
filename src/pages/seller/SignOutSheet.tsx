import { useEffect, useId, useRef, useState } from 'react';
import { tabWrapTarget } from '../../components/import/LeaveDialog';
import { SIGN_OUT_COPY } from './signOutFlow';

type Props = {
  /** 按下「登出」：呼叫端跑登出流程（signOutFlow.performSignOut），回傳是否成功；失敗時面板自己關（呼叫端已提示） */
  onConfirm: () => Promise<boolean>;
  /** 取消、Esc、點遮罩，或登出失敗後關閉 */
  onClose: () => void;
  /** 面板關閉時把焦點還給呼叫它的地方（登出鈕，或收合時的「⋯」）。成功登出會整頁換掉，此時找不到元素就什麼都不做 */
  restoreFocus: () => void;
};

/**
 * 登出確認面板（底部 action sheet，design.md §4）：上卡＝標題＋說明＋「登出」（error-text 粗體），下卡＝「取消」（brand 粗體），兩卡間隔 8。
 * 預設焦點在「取消」（破壞性確認落在安全選項，U-7）；Esc、取消、點遮罩＝不登出；登出中兩顆都不能按、Esc 與點遮罩無效。
 * 面板底用 96% 白（error-text 對它 4.83，過 4.5）；容器吃四邊安全區並避開中線帶（.fold-dialog／.fold-panel，D13）；桌機置中。
 * 動畫沿用 .animate-sheet（iOS sheet 曲線，減少動態改 150ms 淡入）。
 */
export default function SignOutSheet({ onConfirm, onClose, restoreFocus }: Props) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const restoreRef = useRef(restoreFocus);
  useEffect(() => { restoreRef.current = restoreFocus; });

  useEffect(() => {
    cancelRef.current?.focus();
    return () => restoreRef.current();
  }, []);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onConfirm();
    if (!ok) onClose(); // 成功時整頁會換掉（SellerGate 回登入頁），不必再動 state
  };
  const cancel = () => { if (!busy) onClose(); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); return; }
    if (e.key !== 'Tab') return;
    const target = tabWrapTarget([...e.currentTarget.querySelectorAll('button')], document.activeElement, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); }
  };

  const card = 'rounded-[20px] bg-white/96 shadow-popover';
  return (
    <div
      onKeyDown={onKeyDown}
      className="fold-dialog fixed inset-0 z-50 items-end pb-[max(8px,env(safe-area-inset-bottom))] pl-[max(8px,var(--inset-l))] pr-[max(8px,var(--inset-r))] pt-[max(8px,env(safe-area-inset-top))] md:items-center"
    >
      <div aria-hidden="true" onClick={cancel} className="animate-fade absolute inset-0 bg-black/40" />
      <div
        role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className="fold-panel animate-sheet relative flex max-w-md flex-col gap-2 overflow-y-auto md:mx-0 md:max-h-none md:max-w-sm"
      >
        <div className={card}>
          <div className="px-5 pb-4 pt-5 text-center">
            <h2 id={titleId} className="text-headline font-semibold">{SIGN_OUT_COPY.title}</h2>
            <p id={descId} className="mt-1 text-footnote text-muted">{SIGN_OUT_COPY.description}</p>
          </div>
          <button
            type="button" aria-disabled={busy || undefined} onClick={() => void confirm()}
            className={`flex min-h-14 w-full items-center justify-center border-t-[0.5px] border-separator px-4 text-body font-semibold ${busy ? 'text-muted-2' : 'text-error-text active:bg-press'} rounded-b-[20px]`}
          >
            {busy ? SIGN_OUT_COPY.busy : SIGN_OUT_COPY.confirm}
          </button>
        </div>
        <div className={card}>
          <button
            ref={cancelRef} type="button" aria-disabled={busy || undefined} onClick={cancel}
            className={`flex min-h-14 w-full items-center justify-center rounded-[20px] px-4 text-body font-semibold ${busy ? 'text-muted-2' : 'text-brand active:bg-press'}`}
          >
            {SIGN_OUT_COPY.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
