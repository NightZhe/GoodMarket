import { Ban, Info, Store, UserX, WifiOff, X } from 'lucide-react';
import { RULES_TEXT } from '../../lib/chat/rules';

// 導覽列下方的狀態列：離線、我封鎖了對方、對方不存在（同一時間最多一條），加上規則提示。
// 被封鎖方什麼都不顯示（D22、R-M17）：照常能輸入，送出後該則變「無法傳送」。

const BAR = 'flex flex-wrap items-center justify-between gap-x-3 bg-canvas px-4 text-footnote';

export function OfflineBar({ id }: { id: string }) {
  return (
    <p id={id} role="status" className={`${BAR} justify-center py-2 text-muted`}>
      <span className="flex items-center gap-1.5"><WifiOff size={14} aria-hidden="true" />目前離線，無法傳送</span>
    </p>
  );
}

export function BlockedBar({ id, onUnblock, busy }: { id: string; onUnblock: () => void; busy: boolean }) {
  return (
    <div id={id} className={`${BAR} py-0.5`}>
      <span className="flex items-center gap-1.5 py-2 text-ink"><Ban size={14} aria-hidden="true" />你已封鎖此用戶</span>
      <button
        type="button"
        aria-disabled={busy || undefined}
        onClick={busy ? undefined : onUnblock}
        className="ml-auto min-h-11 px-2 font-semibold text-brand transition-opacity duration-200 active:opacity-50 active:duration-0"
      >
        解除封鎖
      </button>
    </div>
  );
}

/** 對方帳號已刪除（買家）／賣場已關閉：歷史照常可看，輸入列停用 */
export function PeerGoneBar({ id, kind }: { id: string; kind: 'account' | 'shop' }) {
  return (
    <p id={id} className={`${BAR} justify-start gap-1.5 py-2 text-ink`}>
      {kind === 'shop' ? <Store size={14} aria-hidden="true" /> : <UserX size={14} aria-hidden="true" />}
      {kind === 'shop' ? '此賣場已關閉' : '此帳號已刪除'}
    </p>
  );
}

/** 規則提示（§10.2）：顯示到使用者按 ✕ 為止。✕ 視覺 16、熱區 44×44 */
export function RulesNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-3 mt-2 flex items-start gap-2 rounded-card bg-canvas p-3 text-footnote text-ink">
      <Info size={16} className="mt-px shrink-0 text-info-text" aria-hidden="true" />
      <p className="min-w-0 flex-1">{RULES_TEXT}</p>
      <button type="button" aria-label="關閉提示" onClick={onDismiss} className="-m-3.5 grid size-11 shrink-0 place-items-center text-muted">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
