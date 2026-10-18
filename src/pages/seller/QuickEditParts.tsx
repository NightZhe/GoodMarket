import { useEffect, useId, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { NUMBER_INPUT_MAX_LENGTH, EDIT_PAGE_LINK_TEXT } from '../../lib/products/variants';
import { conflictDetail, conflictSentence, failureText, type QuickRow } from '../../lib/products/quickEdit';
import { FOCUS_CONFIRM, FOCUS_CONFLICT, FOCUS_FAILED, type QuickPhase, type useQuickEdit } from './useQuickEdit';

export type QuickEditState = ReturnType<typeof useQuickEdit>;

/** 帶著目前的列表網址去編輯頁，存檔後才回得到原本那一頁（見 ProductForm 的 returnTo） */
export interface EditLinkTarget { to: string; state: { from: string } }

const press = 'transition-transform duration-150 motion-safe:active:scale-[0.98]';
/** 處理中只用 aria-busy：aria-disabled 會變灰底白字，對比不夠 */
export const quickSaveBtn = `${btnPrimary} ${press} aria-busy:cursor-wait aria-busy:hover:bg-brand`;
export const quickCancelBtn = `${btnOutline} ${press} aria-disabled:cursor-not-allowed aria-disabled:text-muted`;

/** 依 focusReq 把焦點送到輸入框（data-focus-key＝fieldKey）或決策區的主按鈕；輸入框內容全選 */
export function useFocusRequest(container: RefObject<HTMLElement | null>, req: QuickEditState['focusReq']) {
  useEffect(() => {
    if (!req) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(req.key)}"]`);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [container, req]);
}

interface QuickInputProps {
  id: string;
  focusKey: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  ariaLabel?: string;
  prefix?: boolean;
  readOnly: boolean;
  error: string | null;
  errorId: string;
  tall?: boolean;
  className?: string;
}

/** 數字輸入框：只收數字、最多 6 位；錯誤時紅框並用 aria-describedby 連到訊息 */
export function QuickInput({
  id, focusKey, value, onChange, onEnter, ariaLabel, prefix, readOnly, error, errorId, tall, className = '',
}: QuickInputProps) {
  return (
    <div className={`relative ${className}`}>
      {prefix && (
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted">$</span>
      )}
      <input
        id={id} data-focus-key={focusKey} type="text" inputMode="numeric" autoComplete="off"
        maxLength={NUMBER_INPUT_MAX_LENGTH} value={value} readOnly={readOnly}
        aria-label={ariaLabel} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        className={`block ${tall ? 'h-12' : 'h-11'} w-full rounded-sm border bg-white pr-2 text-base tabular-nums text-ink outline-none read-only:bg-subtle focus:outline focus:outline-1 focus:-outline-offset-1 ${prefix ? 'pl-6' : 'pl-3'} ${
          error ? 'border-error-text! focus:border-error-text! focus:outline-error-text!' : 'border-muted focus:border-ink focus:outline-ink'
        }`}
      />
    </div>
  );
}

/** 欄位錯誤；訊息結尾的「編輯頁」是連到該商品編輯頁的連結 */
export function QuickError({ id, message, edit, className = '' }: { id: string; message: string; edit: EditLinkTarget; className?: string }) {
  const linked = message.endsWith(EDIT_PAGE_LINK_TEXT);
  const head = linked ? message.slice(0, -EDIT_PAGE_LINK_TEXT.length) : message;
  return (
    <p id={id} className={`flex items-start gap-1.5 text-sm text-error-text ${className}`}>
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {head}
        {linked && (
          <Link to={edit.to} state={edit.state} className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            {EDIT_PAGE_LINK_TEXT}
          </Link>
        )}
      </span>
    </p>
  );
}

export function SaveLabel({ busy, retry }: { busy: boolean; retry?: boolean }) {
  if (busy) {
    return (
      <>
        <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
        儲存中…
      </>
    );
  }
  return <>{retry ? '再試一次' : '儲存'}</>;
}

interface DecisionProps {
  phase: QuickPhase;
  rows: QuickRow[];
  qe: QuickEditState;
  /** 手機面板：衝突的三顆按鈕排成「重新填寫」一整行、其餘兩顆一行 */
  mobile?: boolean;
  className?: string;
}

/** 要賣家決定的狀態（大幅改價確認、衝突、失敗）；都在格子或面板裡，不開對話框 */
export function QuickDecision({ phase, rows, qe, mobile, className = '' }: DecisionProps) {
  const msgId = useId();
  const h = mobile ? 'h-12 text-base' : '';
  const btn = (kind: 'primary' | 'outline') => `${kind === 'primary' ? quickSaveBtn : quickCancelBtn} ${h}`;

  if (phase.kind === 'confirm') {
    const single = rows.length === 1;
    const first = phase.lines[0];
    return (
      <div role="group" aria-labelledby={msgId} className={`rounded-sm border border-warning-border bg-warning-bg p-3 ${className}`}>
        <p id={msgId} className="flex items-start gap-2 text-sm font-medium text-ink">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
          <span className="min-w-0">{single && first ? `${first.text}，確定要儲存？` : `這 ${phase.lines.length} 個規格的售價變動很大，確定要儲存？`}</span>
        </p>
        {!single && (
          <ul className="mt-2 space-y-1 pl-[26px] text-sm text-ink">
            {phase.lines.map(l => (
              <li key={l.variantId} className="flex flex-wrap justify-between gap-x-3"><span className="min-w-0 break-words">{l.name}</span><span>{l.text}</span></li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 pl-[26px]">
          <button type="button" onClick={qe.confirmSave} className={`${btn('primary')} ${mobile ? 'flex-1' : ''}`}>確定儲存</button>
          <button type="button" data-focus-key={FOCUS_CONFIRM} onClick={qe.backToEdit} className={btn('outline')}>返回修改</button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'conflict') {
    const single = rows.length === 1 && phase.conflicts.length === 1;
    const only = phase.conflicts[0];
    const variants = new Set(phase.conflicts.map(c => c.variantId)).size;
    return (
      <div role="group" aria-labelledby={msgId} className={`rounded-sm border border-warning-border bg-warning-bg p-3 ${className}`}>
        <p id={msgId} className="flex items-start gap-2 text-sm font-medium text-ink">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
          <span className="min-w-0">
            {single && only ? conflictSentence(only) : `有 ${variants} 個規格在你編輯時被改過，這次沒有儲存任何東西。`}
          </span>
        </p>
        {!single && (
          <ul className="mt-2 space-y-1 pl-[26px] text-sm text-ink">
            {phase.conflicts.map(c => (
              <li key={`${c.variantId}:${c.field}`} className="min-w-0 break-words">{c.variantName}　{conflictDetail(c)}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 pl-[26px]">
          <button type="button" data-focus-key={FOCUS_CONFLICT} onClick={qe.refill} className={`${btn('primary')} ${mobile ? 'w-full' : ''}`}>重新填寫</button>
          <button type="button" onClick={qe.forceSave} className={`${btn('outline')} ${mobile ? 'flex-1' : ''}`}>用我填的值儲存</button>
          <button type="button" onClick={qe.cancel} className={btn('outline')}>取消</button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div role="alert" className={`rounded-sm border border-error-border bg-error-bg p-3 ${className}`}>
        <p className="flex items-start gap-2 text-sm font-medium text-ink">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-error-text" aria-hidden="true" />
          <span className="min-w-0">{failureText(phase.failure)}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2 pl-[26px]">
          {phase.failure !== 'auth' && (
            <button type="button" data-focus-key={FOCUS_FAILED} onClick={qe.submit} className={btn('primary')}>再試一次</button>
          )}
          <button type="button" data-focus-key={phase.failure === 'auth' ? FOCUS_FAILED : undefined} onClick={qe.cancel} className={btn('outline')}>取消</button>
        </div>
      </div>
    );
  }

  return null;
}
