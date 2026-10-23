import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import AddressFields from '../../components/account/AddressFields';
import { focusFirstError, useAddressForm } from '../../components/account/useAddressForm';
import { useRelogin, useRestoreFormDraft } from '../../components/account/useFormDraft';
import { Bone, CheckRow, SubHeader, SubPage, Spinner, bigBtn, savingBtn } from '../../components/account/ui';
import { ADDRESS_LIMIT, EMPTY_DRAFT, fieldOfServerError, formatPhone, normalizePhone, tidyDetail, validateAddress, type AddressDraft } from '../../lib/account/address';
import { saveAddress, type AddressRow } from '../../lib/account/addresses';
import { toAccountError } from '../../lib/account/errors';
import { hasRegion, zipOf } from '../../lib/account/regions';
import { useAddressBook } from '../../lib/account/useAddressBook';
import { useOnline } from '../../lib/useOnline';

const READ_TIMEOUT_MS = 10_000;
const ID = 'af';

/** 新增地址 #/account/addresses/new、編輯地址 #/account/addresses/:id（S-14）。sticky：登入過期時輸入不消失（R-A16） */
export default function AccountAddressForm() {
  return (
    <LoginRequired kind="account" sticky>
      <FormView />
    </LoginRequired>
  );
}

const draftOf = (r: AddressRow): AddressDraft => {
  // 行政區調整後不在清單裡的舊資料：縣市與區回到 placeholder，要重選（R-A18 第 4 點）
  const valid = hasRegion(r.city, r.district);
  return { recipient: r.recipient, phone: formatPhone(r.phone), city: valid ? r.city : '', district: valid ? r.district : '', detail: r.detail };
};

function FormView() {
  const { id } = useParams();
  const editing = id !== undefined;
  const { user } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const relogin = useRelogin();
  const book = useAddressBook({ timeoutMs: READ_TIMEOUT_MS });
  const form = useAddressForm(EMPTY_DRAFT);
  const { draft, errors, reset } = form;

  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [regionAdjusted, setRegionAdjusted] = useState(false);
  const [regionMismatch, setRegionMismatch] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [gone, setGone] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const initialized = useRef(false);

  const rows = book.rows;
  const row = editing && rows ? rows.find(r => r.id === id) ?? null : null;

  // 編輯：讀到那一筆之後，把它放進表單（只做一次；登入回來還原了草稿就以草稿為準）
  useEffect(() => {
    if (initialized.current || !editing || !row) return;
    initialized.current = true;
    const d = draftOf(row);
    reset(d);
    setIsDefault(row.is_default);
    setRegionAdjusted(!hasRegion(row.city, row.district));
  }, [editing, row, reset]);

  useRestoreFormDraft('address', d => {
    if (d.kind !== 'address' || d.id !== (id ?? null)) return;
    initialized.current = true;
    reset(d.value);
    setIsDefault(d.isDefault);
    setReauth(true);
  });

  const known = rows !== null;
  const isFirst = !editing && known && rows.length === 0;
  const currentDefault = rows?.find(r => r.is_default) ?? null;
  const isCurrentDefault = editing && Boolean(row?.is_default);
  const full = !editing && known && rows.length >= ADDRESS_LIMIT;

  const retryRead = async () => {
    setRetrying(true);
    await book.reload();
    setRetrying(false);
  };

  const submit = async () => {
    if (saving || !online) return;
    const errs = form.validateAll();
    if (Object.keys(errs).length > 0) { focusFirstError(errs, ID); return; }
    const zip = zipOf(draft.city, draft.district);
    const phone = normalizePhone(draft.phone);
    if (!zip || !phone) return;
    const asDefault = isFirst || isCurrentDefault || isDefault;
    if (!user) { relogin({ kind: 'address', id: id ?? null, isDefault: asDefault, value: draft }); return; }
    setSaving(true);
    setSaveFailed(false);
    setReauth(false);
    try {
      await saveAddress({
        id: id ?? null, recipient: draft.recipient.trim(), phone, city: draft.city, district: draft.district,
        zip, detail: tidyDetail(draft.detail), isDefault: asDefault,
      });
      toast(editing ? '已儲存地址' : '已新增地址');
      navigate('/account/addresses');
    } catch (e) {
      const err = toAccountError(e);
      const field = fieldOfServerError(err.code);
      if (err.kind === 'auth') relogin({ kind: 'address', id: id ?? null, isDefault: asDefault, value: draft });
      else if (err.code === 'ADDRESS_LIMIT_REACHED') setLimitReached(true);
      else if (err.code === 'ADDRESS_NOT_FOUND') setGone(true);
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

  const title = editing ? '編輯地址' : '新增地址';
  const header = <SubHeader to="/account/addresses" backLabel="回到我的地址" backText="我的地址" title={title} />;

  if (gone || (editing && known && !row && !initialized.current)) {
    return (
      <SubPage noTabBar>
        {header}
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          <Banner kind="error" title="這筆地址已經被刪除" actions={<Link to="/account/addresses" className={btnPrimary}>回我的地址</Link>}>
            可能是你在別的分頁或裝置刪掉了。
          </Banner>
        </div>
      </SubPage>
    );
  }

  if (full || limitReached) {
    return (
      <SubPage noTabBar>
        {header}
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          <Banner kind="warning" role="status" title="地址已經滿 10 筆" actions={<Link to="/account/addresses" className={btnPrimary}>回我的地址</Link>}>
            最多可以存 10 筆。請先刪除一筆，再新增。
          </Banner>
        </div>
      </SubPage>
    );
  }

  if (editing && !initialized.current) {
    return (
      <SubPage noTabBar>
        {header}
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          {book.phase === 'error' ? (
            <Banner
              kind="error" title="讀不到這筆地址"
              actions={<button type="button" className={btnOutline} aria-disabled={retrying || undefined} onClick={() => { if (!retrying) void retryRead(); }}>{retrying ? '重試中…' : '重試'}</button>}
            >
              請檢查網路後再試一次。
            </Banner>
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
          )}
        </div>
      </SubPage>
    );
  }

  const defaultNote = isFirst ? '第一筆地址會自動成為預設。'
    : isCurrentDefault ? '這筆已經是預設。要換預設，請把別筆設為預設。'
    : isDefault && currentDefault ? `儲存後，目前預設的 ${currentDefault.recipient} 會改成一般地址。`
    : undefined;

  return (
    <SubPage noTabBar>
      {header}

      <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
        {reauth && (
          <div className="mb-4">
            <Banner kind="info" role="status" title="已重新登入" actions={<button type="button" className={btnOutline} onClick={() => setReauth(false)}>知道了</button>}>
              你填的地址都還在，請再按一次儲存。
            </Banner>
          </div>
        )}
        {regionAdjusted && (
          <div className="mb-4">
            <Banner kind="info" role="status" title="這筆地址的行政區已經調整">請重新選擇縣市與鄉鎮市區。</Banner>
          </div>
        )}
        {regionMismatch && (
          <div className="mb-4">
            <Banner kind="error" title="縣市和鄉鎮市區對不上，請重新選擇。" />
          </div>
        )}

        <AddressFields
          value={draft} errors={errors} idPrefix={ID} busy={saving}
          onChange={d => { form.change(d); setSaveFailed(false); setRegionMismatch(false); }}
          onBlurField={form.blur}
        />

        <CheckRow
          id={`${ID}-default`} label="設為預設地址" note={defaultNote}
          checked={isFirst || isCurrentDefault || isDefault}
          disabled={isFirst || isCurrentDefault || saving}
          onChange={setIsDefault}
        />

        {!online && (
          <div className="mt-4">
            <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能儲存。你填的資料都還在。</Banner>
          </div>
        )}
        {saveFailed && (
          <div className="mt-4">
            <Banner kind="error" title="沒有儲存成功">請檢查網路後再試一次，你填的地址還在。</Banner>
          </div>
        )}

        <p role="status" className="sr-only">{saving ? '正在儲存地址' : ''}</p>
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
          <Link to="/account/addresses" className={`mt-2 ${btnOutline} ${bigBtn}`}>取消</Link>
        )}
      </form>
    </SubPage>
  );
}
