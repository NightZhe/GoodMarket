import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, MapPin, Plus } from 'lucide-react';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import { AddressSummary } from '../../components/account/AddressView';
import { Bone, SubHeader, SubPage, Spinner, pressCls, textActionCls } from '../../components/account/ui';
import { ADDRESS_LIMIT } from '../../lib/account/address';
import { addressLine, deleteAddress, phoneText, setDefaultAddress, type AddressRow } from '../../lib/account/addresses';
import { toAccountError } from '../../lib/account/errors';
import { useAddressBook } from '../../lib/account/useAddressBook';
import { useOnline } from '../../lib/useOnline';

const READ_TIMEOUT_MS = 10_000;

/** 我的地址 #/account/addresses（S-13） */
export default function AccountAddresses() {
  return (
    <LoginRequired kind="account">
      <AddressesView />
    </LoginRequired>
  );
}

function AddressesView() {
  const toast = useToast();
  const online = useOnline();
  const book = useAddressBook({ timeoutMs: READ_TIMEOUT_MS, refreshOnVisible: true });
  const { rows, phase, reload } = book;
  const [settingId, setSettingId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AddressRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // 列表重排或刪除後焦點要跟著走，不能停在消失的位置；等列表重讀完再移
  const [focusAfter, setFocusAfter] = useState<{ id: string | null } | null>(null);
  const emptyTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusAfter || rows === null) return;
    if (focusAfter.id) document.getElementById(`edit-${focusAfter.id}`)?.focus();
    else emptyTitle.current?.focus();
    setFocusAfter(null);
  }, [focusAfter, rows]);

  const retry = async () => {
    setRetrying(true);
    await reload();
    setRetrying(false);
  };

  const makeDefault = async (a: AddressRow) => {
    if (settingId || !online) return;
    setHintId(null);
    setSettingId(a.id);
    try {
      await setDefaultAddress(a.id);
      await reload(true);
      toast('已設為預設地址');
      setFocusAfter({ id: a.id });
    } catch (e) {
      if (toAccountError(e).code === 'ADDRESS_NOT_FOUND') {
        toast('這筆地址已經被刪除', 'info');
        void reload(true);
      } else {
        toast('設為預設失敗，請檢查網路後再試', 'error');
      }
    } finally {
      setSettingId(null);
    }
  };

  const askDelete = (a: AddressRow) => {
    if (!online) return;
    if (a.is_default && (rows?.length ?? 0) > 1) { setHintId(a.id); return; }
    setHintId(null);
    setDeleting(a);
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy || rows === null) return;
    const target = deleting;
    const at = rows.findIndex(r => r.id === target.id);
    const neighbour = rows[at + 1] ?? rows[at - 1] ?? null;
    setDeleteBusy(true);
    try {
      await deleteAddress(target.id);
      await reload(true);
      toast('已刪除地址');
      setFocusAfter({ id: neighbour?.id ?? null });
    } catch (e) {
      const code = toAccountError(e).code;
      if (code === 'ADDRESS_NOT_FOUND') toast('這筆地址已經被刪除', 'info');
      else if (code === 'ADDRESS_DEFAULT_PROTECTED') toast('預設地址不能刪除，請先把別筆設為預設', 'error');
      else toast('刪除失敗，請檢查網路後再試', 'error');
      void reload(true);
    } finally {
      setDeleting(null);
      setDeleteBusy(false);
    }
  };

  const full = rows !== null && rows.length >= ADDRESS_LIMIT;

  return (
    <SubPage>
      <SubHeader to="/account" backLabel="回到我的帳號" title="我的地址" />

      {rows === null && phase === 'loading' && (
        <ul aria-busy="true" aria-label="我的地址" className="mt-2 divide-y divide-line bg-white md:mt-3 rounded-card">
          <li className="sr-only" role="status">載入中</li>
          {[0, 1, 2].map(i => (
            <li key={i} aria-hidden="true" className="px-4 py-4 md:px-6">
              <Bone className="h-4 w-32" />
              <Bone className="mt-2 h-3 w-full" />
              <Bone className="mt-1.5 h-3 w-2/3" />
            </li>
          ))}
        </ul>
      )}

      {rows === null && phase === 'error' && (
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          {online ? (
            <Banner kind="error" title="讀不到你的地址" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>請檢查網路後再試一次。</Banner>
          ) : (
            <Banner kind="warning" role="status" title="目前沒有網路" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>連上網路後才能看到你的地址。</Banner>
          )}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="mt-2 flex flex-col items-center bg-white px-6 py-12 text-center md:mt-3 rounded-card">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><MapPin size={28} /></span>
          <h2 ref={emptyTitle} tabIndex={-1} className="mt-4 text-base font-medium outline-none">還沒有收件地址</h2>
          <p className="mt-1 text-sm text-muted text-pretty">存起來之後，結帳時會自動帶入。</p>
          <Link to="/account/addresses/new" className={`${btnPrimary} mt-5 h-12 px-6 text-base ${pressCls}`}>
            <Plus size={16} aria-hidden="true" />新增地址
          </Link>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          {!online && (
            <div className="mt-2 md:mt-3">
              <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能新增、編輯或刪除地址。</Banner>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-white px-4 py-3 md:mt-3 rounded-card md:px-6">
            <p className={`min-w-0 text-sm ${full ? 'font-medium' : 'text-muted'}`}>
              {full ? `已存 ${rows.length} / ${ADDRESS_LIMIT} 筆，已達上限。刪除一筆後才能新增。` : `已存 ${rows.length} / ${ADDRESS_LIMIT} 筆`}
            </p>
            {full || !online ? (
              <button type="button" aria-disabled="true" className={`${btnOutline} shrink-0 text-muted`}>
                <Plus size={16} aria-hidden="true" />新增地址
              </button>
            ) : (
              <Link to="/account/addresses/new" className={`${btnPrimary} shrink-0 ${pressCls}`}>
                <Plus size={16} aria-hidden="true" />新增地址
              </Link>
            )}
          </div>

          <ul aria-label="我的地址" className="mt-2 divide-y divide-line bg-white md:mt-3 overflow-hidden rounded-card">
            {rows.map(a => {
              const protectedDefault = a.is_default && rows.length > 1;
              return (
                <li key={a.id} className="px-4 pb-3 pt-4 md:px-6">
                  <AddressSummary name={a.recipient} phone={phoneText(a)} line={addressLine(a)} isDefault={a.is_default} />
                  <div className="-mb-2 -ml-2 mt-1 flex flex-wrap items-center">
                    {online ? (
                      <Link id={`edit-${a.id}`} to={`/account/addresses/${a.id}`} aria-label={`編輯 ${a.recipient} 的地址`} className={textActionCls}>編輯</Link>
                    ) : (
                      <button id={`edit-${a.id}`} type="button" aria-disabled="true" aria-label={`編輯 ${a.recipient} 的地址`} className={`${textActionCls} text-muted`}>編輯</button>
                    )}
                    {!a.is_default && (
                      <button
                        type="button" aria-label={`把 ${a.recipient} 的地址設為預設`}
                        aria-disabled={!online || settingId !== null || undefined} aria-busy={settingId === a.id || undefined}
                        onClick={() => void makeDefault(a)}
                        className={`${textActionCls} ${!online ? 'text-muted' : ''}`}
                      >
                        {settingId === a.id && <Spinner size={14} />}
                        <span className={settingId === a.id ? 'ml-1' : ''}>{settingId === a.id ? '設定中…' : '設為預設'}</span>
                      </button>
                    )}
                    <button
                      type="button" aria-label={`刪除 ${a.recipient} 的地址`}
                      aria-disabled={!online || protectedDefault || undefined}
                      onClick={() => askDelete(a)}
                      className={`${textActionCls} ml-auto ${!online || protectedDefault ? 'text-muted' : 'text-error-text'}`}
                    >
                      刪除
                    </button>
                  </div>
                  {hintId === a.id && (
                    <p role="status" className="mt-2 flex items-start gap-1.5 rounded-sm bg-subtle p-2.5 text-sm">
                      <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
                      <span>預設地址不能直接刪除。先把別筆設為預設，再刪除這一筆。</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {deleting && (
        <LeaveDialog
          title={`刪除 ${deleting.recipient} 的地址？`}
          description={(rows?.length ?? 0) <= 1
            ? '這是你唯一的地址。刪除後，下次結帳要重新填寫收件資料。已經成立的訂單不受影響。'
            : '刪除後，結帳時就不會再帶入這筆地址。已經成立的訂單不受影響。'}
          stayLabel="取消" leaveLabel="刪除" busy={deleteBusy} busyLabel="刪除中…"
          onStay={() => setDeleting(null)} onLeave={() => void confirmDelete()}
        />
      )}
    </SubPage>
  );
}

function RetryButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={btnOutline} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) onClick(); }}>
      {busy ? '重試中…' : '重試'}
    </button>
  );
}
