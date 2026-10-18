import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ProductImage from '../../components/ProductImage';
import { INPUT_LABEL, fieldKey, type QuickField, type QuickRow } from '../../lib/products/quickEdit';
import {
  QuickDecision, QuickError, QuickInput, SaveLabel, quickCancelBtn, quickSaveBtn, useFocusRequest,
  type EditLinkTarget,
} from './QuickEditParts';
import { inputId, useQuickEdit, type UseQuickEditArgs } from './useQuickEdit';

const BOTH: QuickField[] = ['price', 'stock'];

/** iOS Safari 的鍵盤只縮小 visual viewport，fixed 的面板底部會被鍵盤蓋住：跟著 visualViewport 把面板往上移 */
function useKeyboardInset() {
  const [inset, setInset] = useState<{ bottom: number; maxHeight: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const bottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setInset(bottom > 1 ? { bottom, maxHeight: vv.height * 0.85 } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return inset;
}

/** 面板開著時：背景不能捲、不能被讀屏或 Tab 碰到（inert） */
function useModalLock() {
  useEffect(() => {
    const root = document.getElementById('root');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
    return () => {
      document.body.style.overflow = prevOverflow;
      if (root) root.inert = false;
    };
  }, []);
}

interface Props extends Omit<UseQuickEditArgs, 'fields'> {
  edit: EditLinkTarget;
}

/**
 * 手機（< 1024）的底部面板：每個規格一列「售價｜庫存」，價格與庫存一起改、一起存。
 * 有未儲存的修改時視窗被放大到 1024 以上，面板照常開著（置中、限寬）。
 */
export default function QuickEditSheet({ edit, ...args }: Props) {
  const { product } = args;
  const qe = useQuickEdit({ ...args, fields: BOTH });
  const { rows, drafts, errors, phase, busy, slow, announce, changedIds, conflictIds, unsaved } = qe;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inset = useKeyboardInset();
  const multi = rows.length > 1;
  const decision = phase.kind !== 'editing' && phase.kind !== 'saving';
  const readOnly = busy || phase.kind === 'confirm' || phase.kind === 'conflict';

  useModalLock();
  useFocusRequest(panelRef, qe.focusReq);
  // 開啟時焦點先放在標題，不自動叫出鍵盤（iPhone 的鍵盤會蓋掉儲存鍵）
  useEffect(() => { titleRef.current?.focus(); }, []);

  const close = () => { if (!busy) qe.cancel(); };
  // 點遮罩：沒改動就關；有改動不關，改成提示（避免誤觸丟掉 16 個規格的輸入）
  const onBackdrop = () => { if (busy) return; if (qe.dirty) qe.flagUnsaved(); else qe.cancel(); };

  const field = (r: QuickRow, f: QuickField) => {
    const key = fieldKey(r.id, f);
    const id = inputId(product.id, r.id, f);
    return (
      <div className="min-w-0">
        <label htmlFor={id} className="block text-xs text-muted">{INPUT_LABEL[f]}</label>
        <QuickInput
          id={id} focusKey={key} value={drafts[r.id]?.[f] ?? ''} tall prefix={f === 'price'} className="mt-1"
          onChange={v => qe.setDraft(r.id, f, v)} onEnter={qe.submit}
          ariaLabel={multi ? `${r.name} ${INPUT_LABEL[f]}` : undefined}
          readOnly={readOnly} error={errors[key] ?? null} errorId={`${id}-err`}
        />
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={qe.onEscape}>
      <div className="animate-fade absolute inset-0 bg-black/45" onClick={onBackdrop} aria-hidden="true" />
      <div
        ref={panelRef} style={inset ?? undefined}
        className="animate-sheet pb-safe absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-white lg:mx-auto lg:max-w-lg"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line p-4">
          <ProductImage src={product.images[0]} alt="" size="sm" className="w-12 shrink-0 rounded-sm max-[319px]:hidden" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="line-clamp-2 text-base font-bold outline-none max-[319px]:line-clamp-none">
              <span className="sr-only">改價格／庫存：</span>{product.title}
            </h2>
            {multi && <p className="mt-0.5 text-xs text-muted">{rows.length} 種規格</p>}
          </div>
          <button
            type="button" aria-label="關閉" aria-disabled={busy || undefined} onClick={close}
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4" aria-busy={busy || undefined}>
          {rows.map(r => {
            const nameId = `${titleId}-${r.id}`;
            const changed = changedIds.has(r.id);
            const rowErrors = BOTH.filter(f => errors[fieldKey(r.id, f)]);
            return (
              <div
                key={r.id} role="group" aria-labelledby={nameId}
                className={`border-b border-line py-3 last:border-0 ${changed ? '-ml-3 border-l-2 border-l-brand pl-[10px]' : ''} ${conflictIds.has(r.id) ? 'bg-warning-bg' : ''}`}
              >
                <p id={nameId} className={multi ? 'mb-2 break-words text-sm font-medium' : 'sr-only'}>
                  {r.name}{changed && <span className="sr-only">（已修改）</span>}
                </p>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                  {field(r, 'price')}
                  {field(r, 'stock')}
                </div>
                {rowErrors.map(f => (
                  <QuickError key={f} id={`${inputId(product.id, r.id, f)}-err`} message={errors[fieldKey(r.id, f)] ?? ''} edit={edit} className="mt-2" />
                ))}
              </div>
            );
          })}
        </div>

        <div className="max-h-[55dvh] shrink-0 overflow-y-auto border-t border-line bg-white p-4">
          <div role="status">
            {unsaved && <p className="mb-3 rounded-sm border border-warning-border bg-warning-bg px-3 py-2 text-sm text-ink">還沒儲存：請按儲存或取消</p>}
          </div>
          <div className="sr-only" role="status" aria-live="polite">
            {slow ? '儲存中，請稍候' : ''}
            {announce && <span key={announce.id}>{announce.text}</span>}
          </div>
          {decision ? (
            <QuickDecision phase={phase} rows={rows} qe={qe} mobile />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button" aria-busy={busy || undefined} onClick={busy ? undefined : qe.submit}
                className={`${quickSaveBtn} h-12 min-w-[7rem] flex-1 text-base`}
              >
                <SaveLabel busy={busy} />
              </button>
              <button
                type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : qe.cancel}
                className={`${quickCancelBtn} h-12 min-w-[5rem] text-base`}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
