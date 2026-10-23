import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import AddressFields from '../../components/account/AddressFields';
import { focusFirstError, useAddressForm } from '../../components/account/useAddressForm';
import { Bone, SubHeader, Spinner, bigBtn, savingBtn } from '../../components/account/ui';
import { EMPTY_DRAFT, fieldOfServerError, formatPhone, normalizePhone, tidyDetail, validateAddress, type AddressDraft } from '../../lib/account/address';
import { toAccountError } from '../../lib/account/errors';
import { hasRegion, zipOf } from '../../lib/account/regions';
import { saveReturnPersonalAddress } from '../../lib/logistics/api';
import type { ReturnAddress } from '../../lib/logistics/returnStore';
import { useReturnSettings } from '../../lib/logistics/useReturnSettings';
import { useOnline } from '../../lib/useOnline';
import { RetryButton, SETTINGS_READ_TIMEOUT_MS, UnavailableBanner, VisibilityNote } from './logisticsParts';

const ID = 'pf';
const BACK = '/seller/logistics';
const WHITE = 'mt-2 bg-white p-4 md:mt-3 md:rounded-md md:p-6';

const draftOf = (r: ReturnAddress): AddressDraft => {
  // 行政區調整後不在清單裡的舊資料：縣市與區回到 placeholder，要重選
  const valid = hasRegion(r.city, r.district);
  return { recipient: r.recipient, phone: formatPhone(r.phone), city: valid ? r.city : '', district: valid ? r.district : '', detail: r.detail };
};

/**
 * 新增／編輯個人地址 #/seller/logistics/address（設計 5.2）。
 * 每店只有一筆，同一個路由：已有就是編輯、沒有就是新增（資料庫函式也是同一支）。所以要先讀到設定才知道是哪一種。
 */
export default function SellerLogisticsAddressForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const book = useReturnSettings({ timeoutMs: SETTINGS_READ_TIMEOUT_MS });
  const form = useAddressForm(EMPTY_DRAFT);
  const { draft, errors, reset } = form;

  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [regionAdjusted, setRegionAdjusted] = useState(false);
  const [regionMismatch, setRegionMismatch] = useState(false);
  const initialized = useRef(false);

  const settings = book.settings;
  const existing = settings?.personal ?? null;
  const editing = existing !== null;

  // 讀到設定之後，已有個人地址就放進表單（只做一次）
  useEffect(() => {
    if (initialized.current || !settings) return;
    initialized.current = true;
    if (!settings.personal) return;
    reset(draftOf(settings.personal));
    setRegionAdjusted(!hasRegion(settings.personal.city, settings.personal.district));
  }, [settings, reset]);

  const clearSaveState = () => { setSaveFailed(false); setExpired(false); };

  const submit = async () => {
    if (saving || !online) return;
    const errs = form.validateAll();
    if (Object.keys(errs).length > 0) { focusFirstError(errs, ID); return; }
    const zip = zipOf(draft.city, draft.district);
    const phone = normalizePhone(draft.phone);
    if (!zip || !phone) return;
    setSaving(true);
    clearSaveState();
    try {
      await saveReturnPersonalAddress({
        recipient: draft.recipient.trim(), phone, city: draft.city, district: draft.district, zip, detail: tidyDetail(draft.detail),
      });
      toast('已儲存個人地址');
      navigate(BACK);
    } catch (e) {
      const err = toAccountError(e);
      const field = fieldOfServerError(err.code);
      if (err.kind === 'auth') setExpired(true);
      else if (err.kind === 'backend_missing') setUnavailable(true);
      else if (err.code === 'ADDRESS_REGION_INVALID') {
        form.change({ ...draft, city: '', district: '' });
        setRegionMismatch(true);
      } else if (field) {
        form.setFieldError(field, validateAddress(draft)[field] ?? err.message);
        document.getElementById(`${ID}-${field}`)?.focus();
      } else setSaveFailed(true);
      setSaving(false);
    }
  };

  const header = <SubHeader to={BACK} backLabel="回到物流設定" title={editing ? '編輯個人地址' : settings ? '新增個人地址' : '個人地址'} />;
  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-2xl">
      {header}
      <div className={WHITE}>{children}</div>
      <div className="pb-safe"><div className="h-6" /></div>
    </div>
  );

  if (unavailable || book.phase === 'unavailable') return shell(<UnavailableBanner onRetry={() => { setUnavailable(false); return book.reload(); }} />);

  if (!settings) {
    return shell(
      book.phase === 'error' ? (
        <Banner kind="error" title="讀不到退貨地址設定" actions={<RetryButton onRetry={book.reload} />}>請檢查網路後再試一次。</Banner>
      ) : (
        <div aria-busy="true">
          <p role="status" className="sr-only">載入中</p>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={i === 0 ? '' : 'mt-4'}>
              <Bone className="h-4 w-16" />
              <Bone className="mt-2 h-12 w-full" />
            </div>
          ))}
        </div>
      ),
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {header}

      <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} className={WHITE}>
        <VisibilityNote>這個地址會顯示給向你購買、訂單在運送中或已完成的買家。請確認你願意讓買家看到。</VisibilityNote>

        {regionAdjusted && (
          <div className="mt-4">
            <Banner kind="info" role="status" title="這個地址的行政區已經調整">請重新選擇縣市與鄉鎮市區。</Banner>
          </div>
        )}
        {regionMismatch && (
          <div className="mt-4">
            <Banner kind="error" title="縣市和鄉鎮市區對不上，請重新選擇。" />
          </div>
        )}

        <div className="mt-5">
          <AddressFields
            value={draft} errors={errors} idPrefix={ID} busy={saving}
            onChange={d => { form.change(d); clearSaveState(); setRegionMismatch(false); }}
            onBlurField={form.blur}
          />
        </div>

        {!online && (
          <div className="mt-4">
            <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能儲存。你填的資料都還在。</Banner>
          </div>
        )}
        {expired && (
          <div className="mt-4">
            <Banner kind="error" title="登入已過期">請重新整理頁面並重新登入後再儲存。</Banner>
          </div>
        )}
        {saveFailed && (
          <div className="mt-4">
            <Banner kind="error" title="沒有儲存成功">請檢查網路後再試一次，你填的資料還在。</Banner>
          </div>
        )}

        <p role="status" className="sr-only">{saving ? '正在儲存' : ''}</p>
        <button
          type="submit" aria-disabled={saving || !online || undefined} aria-busy={saving || undefined}
          className={`mt-4 ${saving ? savingBtn : btnPrimary} ${bigBtn}`}
        >
          {saving && <Spinner />}
          {saving ? '儲存中…' : '儲存'}
        </button>
        {saving ? (
          <button type="button" aria-disabled="true" className={`mt-2 ${btnOutline} ${bigBtn}`}>取消</button>
        ) : (
          <Link to={BACK} className={`mt-2 ${btnOutline} ${bigBtn}`}>取消</Link>
        )}
      </form>
      <div className="pb-safe"><div className="h-6" /></div>
    </div>
  );
}
