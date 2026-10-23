import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import { AddressContactFields, AddressRegionFields } from '../../components/account/AddressFields';
import { useAddressForm } from '../../components/account/useAddressForm';
import { Bone, CheckRow, FieldError, SubHeader, Spinner, bigBtn, fieldCls, helpCls, labelCls, savingBtn } from '../../components/account/ui';
import { EMPTY_DRAFT, formatPhone, normalizePhone, tidyDetail, validateAddress, type AddressDraft, type AddressField } from '../../lib/account/address';
import { toAccountError } from '../../lib/account/errors';
import { hasRegion, zipOf } from '../../lib/account/regions';
import { saveReturnStore } from '../../lib/logistics/api';
import { BRAND_OPTIONS } from '../../lib/logistics/brands';
import {
  STORE_LIMIT, STORE_NAME_MAX, fieldOfLogisticsError, firstStoreError, storeTitle, validateStoreFields,
  type ReturnStore, type StoreOnlyField,
} from '../../lib/logistics/returnStore';
import { useReturnSettings } from '../../lib/logistics/useReturnSettings';
import { useOnline } from '../../lib/useOnline';
import { RetryButton, SETTINGS_READ_TIMEOUT_MS, UnavailableBanner, VisibilityNote } from './logisticsParts';

const ID = 'sf';
const BACK = '/seller/logistics';
const WHITE = 'mt-2 bg-white p-4 md:mt-3 md:rounded-md md:p-6';

const draftOf = (r: ReturnStore): AddressDraft => {
  // 行政區調整後不在清單裡的舊資料：縣市與區回到 placeholder，要重選
  const valid = hasRegion(r.city, r.district);
  return { recipient: r.recipient, phone: formatPhone(r.phone), city: valid ? r.city : '', district: valid ? r.district : '', detail: r.detail };
};

const legendCls = 'text-sm font-bold';

/** 新增退貨門市 #/seller/logistics/stores/new、編輯退貨門市 #/seller/logistics/stores/:id（設計 S-L2） */
export default function SellerLogisticsStoreForm() {
  // 兩條路由共用同一個元件；只改網址 hash 換成另一筆 id 時 React Router 不會重新掛載，
  // 表單會留著前一筆的資料，儲存就把 A 的內容蓋到 B。用 key 綁 id，換 id 就整頁重置。
  const { id } = useParams();
  return <StoreForm key={id ?? 'new'} />;
}

function StoreForm() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const book = useReturnSettings({ timeoutMs: SETTINGS_READ_TIMEOUT_MS });
  const form = useAddressForm(EMPTY_DRAFT);
  const { draft, errors, reset } = form;

  const [brand, setBrand] = useState('');
  const [storeName, setStoreName] = useState('');
  const [extra, setExtra] = useState<Partial<Record<StoreOnlyField, string>>>({});
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [regionAdjusted, setRegionAdjusted] = useState(false);
  const [regionMismatch, setRegionMismatch] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [gone, setGone] = useState(false);
  const initialized = useRef(false);

  const settings = book.settings;
  const stores = settings?.stores ?? null;
  const row = editing && stores ? stores.find(r => r.id === id) ?? null : null;

  // 編輯：讀到那一筆之後，把它放進表單（只做一次）
  useEffect(() => {
    if (initialized.current || !editing || !row) return;
    initialized.current = true;
    reset(draftOf(row));
    setBrand(row.brand);
    setStoreName(row.store_name);
    setIsDefault(row.is_default);
    setRegionAdjusted(!hasRegion(row.city, row.district));
  }, [editing, row, reset]);

  const known = stores !== null;
  const isFirst = !editing && known && stores.length === 0;
  const currentDefault = stores?.find(r => r.is_default) ?? null;
  const isCurrentDefault = editing && Boolean(row?.is_default);
  const full = !editing && known && stores.length >= STORE_LIMIT;

  const clearSaveState = () => { setSaveFailed(false); setExpired(false); };

  const focusField = (field: string) => {
    const target = field === 'storeName' ? `${ID}-name` : `${ID}-${field}`;
    document.getElementById(target)?.focus();
  };

  const onStoreNameBlur = () => {
    if (storeName.trim() === '') return;
    const msg = validateStoreFields({ brand: 'okmart', storeName }).storeName;
    if (msg) setExtra(prev => ({ ...prev, storeName: msg }));
  };

  const submit = async () => {
    if (saving || !online) return;
    const own = validateStoreFields({ brand, storeName });
    const addrErrs = form.validateAll();
    setExtra(own);
    const first = firstStoreError({ ...own, ...addrErrs });
    if (first) { focusField(first); return; }
    const zip = zipOf(draft.city, draft.district);
    const phone = normalizePhone(draft.phone);
    if (!zip || !phone) return;
    setSaving(true);
    clearSaveState();
    try {
      await saveReturnStore({
        id: id ?? null, brand, storeName: tidyDetail(storeName), recipient: draft.recipient.trim(), phone,
        city: draft.city, district: draft.district, zip, detail: tidyDetail(draft.detail),
        isDefault: isFirst || isCurrentDefault || isDefault,
      });
      toast(editing ? '已儲存退貨門市' : '已新增退貨門市');
      navigate(BACK);
    } catch (e) {
      const err = toAccountError(e);
      const field = fieldOfLogisticsError(err.code);
      if (err.kind === 'auth') setExpired(true);
      else if (err.kind === 'backend_missing') setUnavailable(true);
      else if (err.code === 'RETURN_STORE_LIMIT_REACHED') setLimitReached(true);
      else if (err.code === 'RETURN_STORE_NOT_FOUND') setGone(true);
      else if (err.code === 'ADDRESS_REGION_INVALID') {
        form.change({ ...draft, city: '', district: '' });
        setRegionMismatch(true);
      } else if (field === 'brand') {
        setExtra(prev => ({ ...prev, brand: '請選擇超商品牌' }));
        focusField('brand');
      } else if (field === 'storeName') {
        setExtra(prev => ({ ...prev, storeName: `門市名稱要 1～${STORE_NAME_MAX} 個字` }));
        focusField('storeName');
      } else if (field && field !== 'note') {
        const f = field as AddressField;
        form.setFieldError(f, validateAddress(draft)[f] ?? err.message);
        focusField(f);
      } else setSaveFailed(true);
      setSaving(false);
    }
  };

  const title = editing ? '編輯退貨門市' : '新增退貨門市';
  const header = <SubHeader to={BACK} backLabel="回到物流設定" title={title} />;
  const goBack = <Link to={BACK} className={btnPrimary}>回物流設定</Link>;

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-2xl">
      {header}
      <div className={WHITE}>{children}</div>
      <div className="pb-safe"><div className="h-6" /></div>
    </div>
  );

  if (unavailable || book.phase === 'unavailable') return shell(<UnavailableBanner onRetry={() => { setUnavailable(false); return book.reload(); }} />);

  if (gone || (editing && known && !row && !initialized.current)) {
    return shell(<Banner kind="error" title="這間門市已經被刪除" actions={goBack}>可能是你在別的分頁或裝置刪掉了。</Banner>);
  }

  if (full || limitReached) {
    return shell(
      <Banner kind="warning" role="status" title={`門市已經滿 ${STORE_LIMIT} 間`} actions={goBack}>
        最多可以存 {STORE_LIMIT} 間。請先刪除一間，再新增。
      </Banner>,
    );
  }

  if (editing && !initialized.current) {
    return shell(
      book.phase === 'error' ? (
        <Banner kind="error" title="讀不到這間門市" actions={<RetryButton onRetry={book.reload} />}>請檢查網路後再試一次。</Banner>
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

  const defaultNote = isFirst ? '第一間門市會自動成為預設。'
    : isCurrentDefault ? '這間已經是預設。要換預設，請把別間設為預設。'
    : isDefault && currentDefault ? `儲存後，目前預設的 ${storeTitle(currentDefault)} 會改成一般門市。`
    : '買家只會看到預設門市。';

  const brandErr = extra.brand;
  const nameErr = extra.storeName;
  const regionProps = {
    value: draft, errors, idPrefix: ID, busy: saving,
    onChange: (d: AddressDraft) => { form.change(d); clearSaveState(); setRegionMismatch(false); },
    onBlurField: form.blur,
  };

  return (
    <div className="mx-auto max-w-2xl">
      {header}

      <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} className={WHITE}>
        <VisibilityNote>這些資料會顯示給向你購買、訂單在運送中或已完成的買家；買家只會看到預設門市。</VisibilityNote>

        {regionAdjusted && (
          <div className="mt-4">
            <Banner kind="info" role="status" title="這間門市的行政區已經調整">請重新選擇縣市與鄉鎮市區。</Banner>
          </div>
        )}
        {regionMismatch && (
          <div className="mt-4">
            <Banner kind="error" title="縣市和鄉鎮市區對不上，請重新選擇。" />
          </div>
        )}

        <fieldset className="mt-5 min-w-0">
          <legend className={legendCls}>門市</legend>
          <div className="mt-3">
            <label htmlFor={`${ID}-brand`} className={labelCls}>超商品牌</label>
            <div className="relative mt-1">
              <select
                id={`${ID}-brand`} value={brand} disabled={saving}
                aria-invalid={brandErr ? true : undefined} aria-describedby={brandErr ? `${ID}-brand-err` : undefined}
                onChange={e => { setBrand(e.target.value); setExtra(prev => ({ ...prev, brand: undefined })); clearSaveState(); }}
                className={`scroll-mt-20 ${fieldCls(Boolean(brandErr), 'select', brand === '')}`}
              >
                <option value="">請選擇超商品牌</option>
                {BRAND_OPTIONS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"><ChevronDown size={20} aria-hidden="true" /></span>
            </div>
            <FieldError id={`${ID}-brand-err`}>{brandErr}</FieldError>
          </div>

          <div className="mt-4">
            <label htmlFor={`${ID}-name`} className={labelCls}>門市名稱</label>
            <input
              id={`${ID}-name`} type="text" value={storeName} placeholder="例：好物門市" readOnly={saving || undefined}
              autoComplete="off" autoCapitalize="off" autoCorrect="off" enterKeyHint="next"
              aria-invalid={nameErr ? true : undefined} aria-describedby={[`${ID}-name-help`, nameErr ? `${ID}-name-err` : ''].filter(Boolean).join(' ')}
              onChange={e => {
                const v = e.target.value;
                setStoreName(v);
                clearSaveState();
                // 欄位變合法時錯誤立刻消失
                setExtra(prev => (prev.storeName && !validateStoreFields({ brand: 'okmart', storeName: v }).storeName ? { ...prev, storeName: undefined } : prev));
              }}
              onBlur={onStoreNameBlur}
              className={`mt-1 scroll-mt-20 ${fieldCls(Boolean(nameErr))}`}
            />
            <p id={`${ID}-name-help`} className={helpCls}>超商門市上的名稱，最多 {STORE_NAME_MAX} 字。</p>
            <FieldError id={`${ID}-name-err`}>{nameErr}</FieldError>
          </div>
        </fieldset>

        <fieldset className="mt-6 min-w-0">
          <legend className={legendCls}>門市地址</legend>
          <div className="mt-3"><AddressRegionFields {...regionProps} /></div>
        </fieldset>

        <fieldset className="mt-6 min-w-0">
          <legend className={legendCls}>收件人資料</legend>
          <div className="mt-3"><AddressContactFields {...regionProps} /></div>
        </fieldset>

        <CheckRow
          id={`${ID}-default`} label="設為預設門市" note={defaultNote}
          checked={isFirst || isCurrentDefault || isDefault}
          disabled={isFirst || isCurrentDefault || saving}
          onChange={setIsDefault}
        />

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
