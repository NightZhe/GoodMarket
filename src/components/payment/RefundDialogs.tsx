import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import LeaveDialog from '../import/LeaveDialog';
import { btnDangerText, btnOutline, btnPrimary } from '../import/ui';
import { useOnline } from '../../lib/useOnline';
import { money } from '../../lib/format';
import {
  BUYER_CANCEL_REASONS, CANCEL_RESPOND_HOURS, NOTE_MAX, SELLER_CANCEL_REASONS, cardLine, reasonText,
} from '../../lib/payment/refundView';
import type { BuyerCancelReason, SellerCancelReason } from '../../lib/payment/types';
import { LineView, type CardInfo } from './RefundBlocks';

// 退款設計 4.4、5.4：五個對話框。文字逐字照設計表格。
// 純確認（撤回申請、同意取消並退款）沿用 LeaveDialog（焦點在安全選項）；含表單的三個（申請取消、拒絕、取消並退款）
// 共用 FormDialogShell：焦點進標題、內文自己捲、按鈕列釘底（小螢幕、200% 字級、鍵盤彈起時按鈕仍看得到）。
// 兩種都：Esc 關閉（處理中除外）、Tab 在對話框內循環、關閉後焦點回到原本的元素。

const OFFLINE_SUBMIT = '目前沒有網路連線，連上網路後才能送出。';
const OFFLINE_ACT = '目前沒有網路連線，連上網路後才能操作。';

const FOCUSABLE = 'button, textarea, input, a[href]';

function FormDialogShell({ title, busy, busyLabel, notice, footer, onClose, children }: {
  title: string; busy: boolean; busyLabel: string; notice?: string; footer: ReactNode; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => !el.hasAttribute('disabled'));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="relative flex max-h-[calc(90dvh-2rem)] w-full max-w-md flex-col rounded-lg bg-white shadow-popover"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-3 max-[359px]:p-4">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-bold outline-none">{title}</h2>
          {children}
        </div>
        {notice && <p role="status" className="shrink-0 px-6 pb-2 text-sm text-muted max-[359px]:px-4">{notice}</p>}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line p-4 md:flex-row md:justify-end md:px-6">{footer}</div>
        <p role="status" className="sr-only">{busy ? busyLabel : ''}</p>
      </div>
    </div>
  );
}

function ActionButton({ className, busy, busyLabel, disabled, label, onClick }: {
  className: string; busy: boolean; busyLabel: string; disabled: boolean; label: string; onClick: () => void;
}) {
  return (
    <button type="button" aria-disabled={busy || disabled || undefined} onClick={busy || disabled ? undefined : onClick} className={className}>
      {busy && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
      {busy ? busyLabel : label}
    </button>
  );
}

const textareaCls = 'mt-1 block w-full rounded-sm border border-muted bg-white px-3 py-2 text-base text-ink outline-none focus:border-ink';

// 錯誤出現時捲到看得到：內文區自己捲，錯誤訊息可能在可視範圍之外（小螢幕、200% 字級）
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, []);
  return (
    <p ref={ref} id={id} role="alert" className="mt-1 flex items-start gap-1.5 text-sm text-error-text">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{children}
    </p>
  );
}

/** 補充說明／拒絕原因：textarea 字級 16px（iOS Safari 才不會自動放大）、最多 100 字、下方 0/100 */
function NoteField({ label, value, onChange, placeholder, error, errorId, textareaRef }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  error?: string | null; errorId: string; textareaRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <textarea
        id={id} ref={textareaRef} rows={3} maxLength={NOTE_MAX} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className={textareaCls}
      />
      <p className="mt-1 text-sm text-muted">{value.length}/{NOTE_MAX}</p>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** 原因單選：原生 radio，整列 label ≥44px；選「其他」才展開補充說明 */
function ReasonFields<C extends string>({ options, reason, onReason, note, onNote, noteLabel, error, firstRef }: {
  options: { code: C; label: string }[]; reason: C | null; onReason: (c: C) => void;
  note: string; onNote: (v: string) => void; noteLabel: string; error: string | null; firstRef: React.Ref<HTMLInputElement>;
}) {
  const name = useId();
  const errorId = useId();
  return (
    <>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">取消原因（必選）</legend>
        <ul className={`mt-1.5 divide-y divide-line overflow-hidden rounded-sm border ${error ? 'border-error-text' : 'border-line'}`}>
          {options.map((o, i) => (
            <li key={o.code}>
              <label className={`flex min-h-11 items-center gap-3 px-3 py-2 text-sm ${reason === o.code ? 'bg-brand-soft' : ''}`}>
                <input
                  type="radio" name={name} value={o.code} checked={reason === o.code} onChange={() => onReason(o.code)}
                  ref={i === 0 ? firstRef : undefined}
                  aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
                  className="h-5 w-5 shrink-0 accent-brand"
                />
                {o.label}
              </label>
            </li>
          ))}
        </ul>
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </fieldset>
      {reason === 'other' && <NoteField label={noteLabel} value={note} onChange={onNote} errorId={`${errorId}-note`} />}
    </>
  );
}

const para = 'mt-2 text-sm text-ink';

/** D-B1　申請取消（買家） */
export function RequestCancelDialog({ total, card, hasSiblings, onClose, onSubmit }: {
  total: number; card: CardInfo | null; hasSiblings: boolean; onClose: () => void;
  /** 回傳字串＝顯示在欄位下方的錯誤（對話框保持開著）；null＝呼叫端已處理（成功就關掉，其他錯誤已用 toast） */
  onSubmit: (reason: BuyerCancelReason, note: string) => Promise<string | null>;
}) {
  const online = useOnline();
  const [reason, setReason] = useState<BuyerCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!reason) { setError('請選擇取消原因。'); firstRef.current?.focus(); return; }
    setBusy(true);
    const err = await onSubmit(reason, reason === 'other' ? note.trim() : '');
    setBusy(false);
    if (err) { setError(err); firstRef.current?.focus(); }
  };

  return (
    <FormDialogShell
      title="申請取消這筆訂單？" busy={busy} busyLabel="送出中…" notice={online ? undefined : OFFLINE_SUBMIT} onClose={onClose}
      footer={<>
        <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : onClose} className={btnOutline}>先不要</button>
        <ActionButton className={btnPrimary} busy={busy} busyLabel="送出中…" disabled={!online} label="送出取消申請" onClick={() => void submit()} />
      </>}
    >
      <p className={para}><LineView line={cardLine(card !== null, `賣家同意後，訂單會取消且無法復原，全額 ${money(total)} 會退回`, '。')} card={card} /></p>
      <p className={para}>賣家回應前不會出貨。賣家在 {CANCEL_RESPOND_HOURS} 小時內沒有回應，會自動取消並退款。</p>
      <p className={`${para} font-bold`}>每張訂單只能申請一次：送出後，即使撤回或被賣家拒絕，都不能再申請。</p>
      {hasSiblings && <p className={para}>同一次付款的其他訂單不受影響。</p>}
      <ReasonFields
        options={BUYER_CANCEL_REASONS} reason={reason} onReason={c => { setReason(c); setError(null); }}
        note={note} onNote={setNote} noteLabel="補充說明（選填，最多 100 字，賣家看得到）" error={error} firstRef={firstRef}
      />
    </FormDialogShell>
  );
}

/** D-S2　拒絕取消申請（賣家） */
export function RejectCancelDialog({ onClose, onSubmit }: {
  onClose: () => void; onSubmit: (rejectReason: string) => Promise<string | null>;
}) {
  const online = useOnline();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  const submit = async () => {
    if (!text.trim()) { setError('請填寫拒絕原因。'); areaRef.current?.focus(); return; }
    setBusy(true);
    const err = await onSubmit(text.trim());
    setBusy(false);
    if (err) { setError(err); areaRef.current?.focus(); }
  };

  return (
    <FormDialogShell
      title="拒絕取消申請？" busy={busy} busyLabel="送出中…" notice={online ? undefined : OFFLINE_SUBMIT} onClose={onClose}
      footer={<>
        <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : onClose} className={btnOutline}>先不要</button>
        <ActionButton className={btnPrimary} busy={busy} busyLabel="送出中…" disabled={!online} label="送出拒絕" onClick={() => void submit()} />
      </>}
    >
      <p className={para}>訂單會照常待出貨，需要你出貨。買家每張訂單只能申請一次，被拒絕後不能再申請。</p>
      <NoteField
        label="拒絕原因（必填，最多 100 字，買家看得到）" value={text} onChange={v => { setText(v); setError(null); }}
        placeholder="例如：商品已經打包，今天會寄出。" error={error} errorId={errorId} textareaRef={areaRef}
      />
    </FormDialogShell>
  );
}

/** D-S3　取消並退款（賣家主動）。H-RF3 確認前不放「帳戶餘額」那句 */
export function SellerCancelDialog({ total, onClose, onSubmit }: {
  total: number; onClose: () => void; onSubmit: (reason: SellerCancelReason, note: string) => Promise<string | null>;
}) {
  const online = useOnline();
  const [reason, setReason] = useState<SellerCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!reason) { setError('請選擇取消原因。'); firstRef.current?.focus(); return; }
    setBusy(true);
    const err = await onSubmit(reason, reason === 'other' ? note.trim() : '');
    setBusy(false);
    if (err) { setError(err); firstRef.current?.focus(); }
  };

  return (
    <FormDialogShell
      title="取消並退款？" busy={busy} busyLabel="處理中…" notice={online ? undefined : OFFLINE_ACT} onClose={onClose}
      footer={<>
        <ActionButton className={btnDangerText} busy={busy} busyLabel="處理中…" disabled={!online} label="取消並退款" onClick={() => void submit()} />
        <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : onClose} className={btnPrimary}>保留訂單</button>
      </>}
    >
      <p className={para}>取消後，全額 {money(total)}（含運費）會退款給買家，這張訂單變成已取消，商品庫存會退回。無法復原。</p>
      <p className={para}>買家看得到你選的取消原因。好物集會向綠界科技辦理退款，不需要你到綠界後台操作。</p>
      <ReasonFields
        options={SELLER_CANCEL_REASONS} reason={reason} onReason={c => { setReason(c); setError(null); }}
        note={note} onNote={setNote} noteLabel="補充說明（選填，最多 100 字，買家看得到）" error={error} firstRef={firstRef}
      />
    </FormDialogShell>
  );
}

/** D-B2　撤回申請（買家；純確認，安全選項＝保留申請） */
export function WithdrawCancelDialog({ onStay, onConfirm }: { onStay: () => void; onConfirm: () => Promise<void> }) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  return (
    <LeaveDialog
      title="撤回取消申請？"
      description="撤回後，訂單照常出貨。每張訂單只能申請一次，撤回後這筆訂單不能再申請取消。"
      stayLabel="保留申請" leaveLabel="撤回申請" busy={busy} busyLabel="撤回中…"
      offlineNotice={online ? undefined : OFFLINE_SUBMIT}
      onStay={onStay} onLeave={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }}
    />
  );
}

/** D-S1　同意取消並退款（賣家；純確認，安全選項＝先不要） */
export function AcceptCancelDialog({ total, reason, note, onStay, onConfirm }: {
  total: number; reason: BuyerCancelReason; note: string | null; onStay: () => void; onConfirm: () => Promise<void>;
}) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  return (
    <LeaveDialog
      title="同意取消並退款？"
      description={<>
        <p>買家申請取消，原因：{reasonText(reason, note)}。</p>
        <p className="mt-2">同意後，全額 {money(total)}（含運費）會退款給買家，這張訂單變成已取消，商品庫存會退回。無法復原。</p>
        <p className="mt-2">好物集會向綠界科技辦理退款，不需要你到綠界後台操作。</p>
      </>}
      stayLabel="先不要" leaveLabel="同意取消並退款" busy={busy} busyLabel="處理中…"
      offlineNotice={online ? undefined : OFFLINE_ACT}
      onStay={onStay} onLeave={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }}
    />
  );
}
