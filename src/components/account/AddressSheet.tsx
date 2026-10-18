import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import SheetShell from '../SheetShell';
import Banner from '../import/Banner';
import { btnPrimary } from '../import/ui';
import { useToast } from '../Toast';
import AddressFields from './AddressFields';
import { rowSummary } from './AddressView';
import { focusFirstError, useAddressForm } from './useAddressForm';
import { CheckRow, Spinner, bigBtn, savingBtn, textActionCls } from './ui';
import {
  ADDRESS_LIMIT, EMPTY_DRAFT, fieldOfServerError, formatPhone, normalizePhone, validateAddress, type AddressDraft,
} from '../../lib/account/address';
import { saveAddress, type AddressRow } from '../../lib/account/addresses';
import { toAccountError } from '../../lib/account/errors';
import { hasRegion, zipOf } from '../../lib/account/regions';
import { useOnline } from '../../lib/useOnline';

type Step = { kind: 'list' } | { kind: 'form'; id: string | null };

interface Props {
  rows: AddressRow[];
  /** 目前結帳用的是哪一筆（單選的初始值）；null＝沒有（例如那筆已被刪） */
  selectedId: string | null;
  /** 重讀地址簿（在抽屜裡編輯或新增，就是改地址簿本身） */
  reload: () => Promise<boolean>;
  onUse: (id: string) => void;
  onClose: () => void;
  /** 儲存時發現登入過期：由結帳頁帶著結帳快照去開登入面板 */
  onAuthLost: () => void;
}

const draftOf = (r: AddressRow): AddressDraft => {
  const valid = hasRegion(r.city, r.district);
  return { recipient: r.recipient, phone: formatPhone(r.phone), city: valid ? r.city : '', district: valid ? r.district : '', detail: r.detail };
};

/**
 * 結帳頁的「選擇收件地址」抽屜（手機）／對話框（桌機）。
 * 單選＋「使用這個地址」確認鈕：選取不該引發畫面變動（WCAG 3.2.2），「編輯」和單選在同一列，點錯一次不該就關掉。
 * 抽屜裡只能編輯與新增，不提供刪除（刪除只在「我的地址」頁）。
 */
export default function AddressSheet({ rows, selectedId, reload, onUse, onClose, onAuthLost }: Props) {
  const toast = useToast();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [choice, setChoice] = useState<string | null>(selectedId ?? rows.find(r => r.is_default)?.id ?? rows[0]?.id ?? null);
  const [focusEdit, setFocusEdit] = useState<string | null>(null);
  const stepKey = step.kind === 'list' ? 'list' : `form-${step.id ?? 'new'}`;

  // 步驟切換時焦點移到新步驟的標題；從編輯回清單時改回到那列的「編輯」
  const lastKey = useRef(stepKey);
  useEffect(() => {
    if (lastKey.current === stepKey) return;
    lastKey.current = stepKey;
    if (focusEdit) {
      document.getElementById(`sheet-edit-${focusEdit}`)?.focus();
      setFocusEdit(null);
    } else {
      titleRef.current?.focus();
    }
  }, [stepKey, focusEdit]);

  const full = rows.length >= ADDRESS_LIMIT;

  if (step.kind === 'form') {
    return (
      <SheetShell titleId="sheet-title" titleRef={titleRef} onClose={onClose}>
        <SheetForm
          key={stepKey}
          row={step.id ? rows.find(r => r.id === step.id) ?? null : null}
          isFirst={rows.length === 0} currentDefault={rows.find(r => r.is_default) ?? null}
          titleRef={titleRef} onClose={onClose} onAuthLost={onAuthLost}
          onBack={() => setStep({ kind: 'list' })}
          onSaved={async (saved, wasNew) => {
            await reload();
            if (wasNew) setChoice(saved.id);
            toast(wasNew ? '已新增地址' : '已儲存地址');
            setFocusEdit(wasNew ? null : saved.id);
            setStep({ kind: 'list' });
          }}
          onGone={async () => { toast('這筆地址已經被刪除', 'info'); await reload(); setStep({ kind: 'list' }); }}
        />
      </SheetShell>
    );
  }

  return (
    <SheetShell titleId="sheet-title" titleRef={titleRef} onClose={onClose}>
      <div className="p-4 md:p-6">
        <div className="flex items-start gap-2">
          <h2 id="sheet-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 pt-px text-lg font-bold outline-none">選擇收件地址</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <ul role="radiogroup" aria-label="收件地址" className="-mx-4 mt-3 divide-y divide-line border-y border-line md:-mx-6">
          {rows.map(a => (
            <li key={a.id} className={`flex flex-wrap items-center ${choice === a.id ? 'bg-brand-soft' : ''}`}>
              <label className="flex min-w-0 flex-1 basis-36 items-start gap-3 py-3 pl-4 pr-2">
                <input
                  type="radio" name="ck-address" checked={choice === a.id} onChange={() => setChoice(a.id)}
                  className="mt-1 h-5 w-5 shrink-0 accent-brand"
                />
                <span className="min-w-0 flex-1">{rowSummary(a, true)}</span>
              </label>
              <button
                id={`sheet-edit-${a.id}`} type="button" aria-label={`編輯 ${a.recipient} 的地址`}
                onClick={() => setStep({ kind: 'form', id: a.id })}
                className={`${textActionCls} ml-12 mr-2 min-[360px]:ml-0`}
              >
                編輯
              </button>
            </li>
          ))}
          <li>
            <button
              type="button" aria-disabled={full || undefined}
              onClick={() => { if (!full) setStep({ kind: 'form', id: null }); }}
              className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm md:px-6 ${full ? 'text-muted' : ''}`}
            >
              <Plus size={20} className="shrink-0 text-muted" aria-hidden="true" />
              {full ? `新增地址（已達 ${ADDRESS_LIMIT} 筆上限）` : '新增地址'}
            </button>
          </li>
        </ul>

        <div className="pb-safe sticky bottom-0 -mx-4 border-t border-line bg-white md:-mx-6">
          <div className="p-4 md:px-6">
            <button
              type="button" aria-disabled={choice === null || undefined}
              onClick={() => { if (choice) onUse(choice); }}
              className={`${btnPrimary} ${bigBtn}`}
            >
              使用這個地址
            </button>
          </div>
        </div>
      </div>
    </SheetShell>
  );
}

interface FormProps {
  row: AddressRow | null;
  isFirst: boolean;
  currentDefault: AddressRow | null;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onClose: () => void;
  onAuthLost: () => void;
  onSaved: (saved: AddressRow, wasNew: boolean) => Promise<void>;
  onGone: () => Promise<void>;
}

function SheetForm({ row, isFirst, currentDefault, titleRef, onBack, onClose, onAuthLost, onSaved, onGone }: FormProps) {
  const online = useOnline();
  const form = useAddressForm(row ? draftOf(row) : EMPTY_DRAFT);
  const { draft, errors } = form;
  const [isDefault, setIsDefault] = useState(row?.is_default ?? false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [limit, setLimit] = useState(false);
  const adjusted = row !== null && !hasRegion(row.city, row.district);
  const editing = row !== null;
  const isCurrentDefault = Boolean(row?.is_default);

  const submit = async () => {
    if (saving || !online) return;
    const errs = form.validateAll();
    if (Object.keys(errs).length > 0) { focusFirstError(errs, 'sf'); return; }
    const zip = zipOf(draft.city, draft.district);
    const phone = normalizePhone(draft.phone);
    if (!zip || !phone) return;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await saveAddress({
        id: row?.id ?? null, recipient: draft.recipient.trim(), phone, city: draft.city, district: draft.district,
        zip, detail: draft.detail.trim(), isDefault: isFirst || isCurrentDefault || isDefault,
      });
      await onSaved(saved, !editing);
    } catch (e) {
      const err = toAccountError(e);
      const field = fieldOfServerError(err.code);
      if (err.kind === 'auth') onAuthLost();
      else if (err.code === 'ADDRESS_LIMIT_REACHED') setLimit(true);
      else if (err.code === 'ADDRESS_NOT_FOUND') await onGone();
      else if (err.code === 'ADDRESS_REGION_INVALID') { form.change({ ...draft, city: '', district: '' }); setMismatch(true); }
      else if (field) { form.setFieldError(field, validateAddress(draft)[field] ?? err.message); document.getElementById(`sf-${field}`)?.focus(); }
      else setFailed(true);
      setSaving(false);
    }
  };

  const defaultNote = isFirst ? '第一筆地址會自動成為預設。'
    : isCurrentDefault ? '這筆已經是預設。要換預設，請把別筆設為預設。'
    : isDefault && currentDefault ? `儲存後，目前預設的 ${currentDefault.recipient} 會改成一般地址。`
    : undefined;

  return (
    <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} aria-label="地址表單">
      <div className="p-4 md:p-6">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onBack} aria-label="回到選擇收件地址" className="-ml-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <h2 id="sheet-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 pt-px text-lg font-bold outline-none">{editing ? '編輯地址' : '新增地址'}</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {limit ? (
          <div className="mt-4">
            <Banner kind="warning" role="status" title="地址已經滿 10 筆">最多可以存 10 筆。請先到「我的帳號 › 地址」刪除一筆，再新增。</Banner>
          </div>
        ) : (
          <div className="mt-4">
            {adjusted && <div className="mb-4"><Banner kind="info" role="status" title="這筆地址的行政區已經調整">請重新選擇縣市與鄉鎮市區。</Banner></div>}
            {mismatch && <div className="mb-4"><Banner kind="error" title="縣市和鄉鎮市區對不上，請重新選擇。" /></div>}
            <AddressFields
              value={draft} errors={errors} idPrefix="sf" compact busy={saving}
              onChange={d => { form.change(d); setFailed(false); setMismatch(false); }}
              onBlurField={form.blur}
            />
            <CheckRow
              id="sf-default" label="設為預設地址" note={defaultNote}
              checked={isFirst || isCurrentDefault || isDefault} disabled={isFirst || isCurrentDefault || saving}
              onChange={setIsDefault}
            />
          </div>
        )}
      </div>

      {!limit && (
        <div className="pb-safe sticky bottom-0 border-t border-line bg-white">
          <div className="p-4 md:px-6">
            {!online && <div className="mb-3"><Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能儲存。你填的資料都還在。</Banner></div>}
            {failed && <div className="mb-3"><Banner kind="error" title="沒有儲存成功">請檢查網路後再試一次，你填的地址還在。</Banner></div>}
            <p role="status" className="sr-only">{saving ? '正在儲存地址' : ''}</p>
            <button
              type="submit" aria-disabled={saving || !online || undefined} aria-busy={saving || undefined}
              className={`${saving ? savingBtn : btnPrimary} ${bigBtn}`}
            >
              {saving && <Spinner />}
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
