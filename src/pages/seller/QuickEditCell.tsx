import { useEffect, useId, useRef } from 'react';
import { Check, Pencil } from 'lucide-react';
import { priceRange } from '../../lib/format';
import { FIELD_NAME, INPUT_LABEL, fieldKey, type QuickField } from '../../lib/products/quickEdit';
import { LOW_STOCK } from '../../lib/products/stock';
import type { Product } from '../../types';
import {
  QuickDecision, QuickError, QuickInput, SaveLabel, quickCancelBtn, quickSaveBtn, useFocusRequest,
  type EditLinkTarget,
} from './QuickEditParts';
import { inputId, useQuickEdit, type UseQuickEditArgs } from './useQuickEdit';

interface ButtonProps {
  product: Product;
  field: QuickField;
  stock: number;
  onOpen: () => void;
  /** 剛存完：格子下面小字「已更新」（視覺用，讀屏另有 live region） */
  updated: boolean;
}

/** 列表上的價格格／庫存格：是按鈕，點了進單格編輯模式 */
export function QuickCellButton({ product, field, stock, onOpen, updated }: ButtonProps) {
  const text = field === 'price' ? priceRange(product.variants.map(v => v.price)) : String(stock);
  const low = field === 'stock' && stock <= LOW_STOCK;
  return (
    <div className="hidden lg:block">
      <button
        type="button" data-qe-cell={`${product.id}:${field}`} onClick={onOpen}
        aria-label={`${product.title} ${FIELD_NAME[field]} ${field === 'price' ? text : stock}，編輯`}
        className="group/c -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-1.5 rounded-sm px-2 text-left text-sm hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className={`underline decoration-dotted decoration-muted underline-offset-4 ${low ? 'text-error-text' : ''}`}>{text}</span>
        <Pencil size={13} className="shrink-0 text-muted opacity-0 group-hover/c:opacity-100 group-focus-visible/c:opacity-100" aria-hidden="true" />
      </button>
      {updated && (
        <p aria-hidden="true" className="flex items-center gap-1 pt-0.5 text-xs text-success-text"><Check size={14} />已更新</p>
      )}
    </div>
  );
}

interface BlockProps extends Omit<UseQuickEditArgs, 'fields'> {
  field: QuickField;
  edit: EditLinkTarget;
  /** 有改動時去點別的格子：外層加一，這裡顯示「還沒儲存」並把焦點還回來 */
  nag: number;
}

/** 單格編輯模式（桌機）：格子原地長大；單規格一個輸入框，多規格每個規格一列、儲存列貼底 */
export function QuickEditBlock({ field, edit, nag, ...args }: BlockProps) {
  const { product } = args;
  const qe = useQuickEdit({ ...args, fields: [field] });
  const { rows, drafts, errors, phase, busy, dirty, unsaved, slow, announce, changedIds, conflictIds } = qe;
  const ref = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const legendId = useId();
  const multi = rows.length > 1;
  const label = INPUT_LABEL[field];
  const decision = phase.kind === 'confirm' || phase.kind === 'conflict';
  const readOnly = busy || decision;
  const showButtons = phase.kind === 'editing' || phase.kind === 'saving';

  useFocusRequest(ref, qe.focusReq);

  // 進入時焦點在第一個輸入框、內容全選
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLInputElement>('input');
    first?.focus();
    first?.select();
  }, []);

  // 有改動時去點別的格子：不切換，焦點回到區塊裡最後有焦點的控制項（沒有就第一個輸入框）
  const { flagUnsaved } = qe;
  useEffect(() => {
    if (nag === 0) return;
    flagUnsaved();
    const target = lastFocus.current && ref.current?.contains(lastFocus.current) ? lastFocus.current : ref.current?.querySelector<HTMLElement>('input');
    target?.focus();
  }, [nag, flagUnsaved]);

  const buttons = (
    <div className="flex gap-2">
      <button type="button" aria-busy={busy || undefined} onClick={busy ? undefined : qe.submit} className={quickSaveBtn}>
        <SaveLabel busy={busy} />
      </button>
      <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : qe.cancel} className={quickCancelBtn}>取消</button>
    </div>
  );

  const inputFor = (rowId: string, rowName: string, wide: boolean) => {
    const key = fieldKey(rowId, field);
    const id = inputId(product.id, rowId, field);
    return (
      <QuickInput
        id={id} focusKey={key} value={drafts[rowId]?.[field] ?? ''}
        onChange={v => qe.setDraft(rowId, field, v)} onEnter={qe.submit}
        ariaLabel={wide ? `${rowName} ${label}` : undefined}
        prefix={field === 'price'} readOnly={readOnly} error={errors[key] ?? null} errorId={`${id}-err`}
        className={wide ? 'w-full' : field === 'price' ? 'mt-1 w-28' : 'mt-1 w-24'}
      />
    );
  };

  return (
    <div
      ref={ref} role="group" aria-labelledby={legendId} aria-busy={busy || undefined}
      onKeyDown={qe.onEscape} onFocusCapture={e => { lastFocus.current = e.target as HTMLElement; }}
      className="group/qe relative min-w-0 rounded-md border border-muted bg-subtle p-3 lg:col-span-3"
    >
      <span id={legendId} className="sr-only">修改「{product.title}」的{FIELD_NAME[field]}</span>
      <div role="status">
        {unsaved && (
          <p className="mb-3 rounded-sm border border-warning-border bg-warning-bg px-3 py-2 text-sm text-ink">還沒儲存：請按儲存或取消</p>
        )}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {slow ? '儲存中，請稍候' : ''}
        {announce && <span key={announce.id}>{announce.text}</span>}
      </div>
      {dirty && (phase.kind === 'editing' || phase.kind === 'failed') && (
        <span className="absolute -top-2.5 right-3 rounded-sm border border-warning-border bg-warning-bg px-1.5 text-xs leading-5 text-warning-text group-focus-within/qe:hidden">未儲存</span>
      )}

      {!multi ? (
        <>
          {rows.map(r => {
            const key = fieldKey(r.id, field);
            return (
              <div key={r.id}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
                  <div>
                    <label htmlFor={inputId(product.id, r.id, field)} className="block text-xs text-muted">{label}</label>
                    {inputFor(r.id, r.name, false)}
                  </div>
                  {showButtons && <div className="self-end">{buttons}</div>}
                </div>
                {errors[key] && <QuickError id={`${inputId(product.id, r.id, field)}-err`} message={errors[key]} edit={edit} className="mt-2" />}
              </div>
            );
          })}
          {phase.kind !== 'editing' && phase.kind !== 'saving' && <QuickDecision phase={phase} rows={rows} qe={qe} className="mt-3" />}
        </>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-x-3 gap-y-1">
            <span className="block text-xs text-muted">規格</span>
            <span className="block text-xs text-muted">{label}</span>
            {rows.map(r => {
              const key = fieldKey(r.id, field);
                const tint = conflictIds.has(r.id) ? 'bg-warning-bg ring-1 ring-warning-border' : changedIds.has(r.id) ? 'bg-brand-soft' : '';
              return (
                <div key={r.id} className="col-span-full">
                  <div className={`-mx-1.5 grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 rounded-sm px-1.5 py-1 ${tint}`}>
                    <span className="min-w-0 break-words text-sm">
                      {r.name}
                      {changedIds.has(r.id) && <span className="sr-only">（已修改）</span>}
                    </span>
                    {inputFor(r.id, r.name, true)}
                  </div>
                  {errors[key] && <QuickError id={`${inputId(product.id, r.id, field)}-err`} message={errors[key]} edit={edit} className="mt-1" />}
                </div>
              );
            })}
          </div>
          {/* 儲存列貼底，捲動時一直看得到；要賣家決定的訊息不貼底，不然會蓋住上面還在對照的規格列 */}
          <div className={`-mx-3 -mb-3 mt-2 rounded-b-md border-t border-line bg-subtle px-3 pb-3 pt-3 ${decision || phase.kind === 'failed' ? '' : 'sticky bottom-0'}`}>
            {decision || phase.kind === 'failed' ? (
              <QuickDecision phase={phase} rows={rows} qe={qe} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-sm text-muted">{changedIds.size > 0 ? `已修改 ${changedIds.size} 個規格` : '還沒修改'}</p>
                {buttons}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
