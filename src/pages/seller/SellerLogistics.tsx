import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Plus } from 'lucide-react';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary, focusRing } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import { DefaultTag } from '../../components/account/AddressView';
import { Bone, FieldError, Spinner, fieldCls, pressCls, savingBtn, textActionCls } from '../../components/account/ui';
import { formatPhone } from '../../lib/account/address';
import { toAccountError } from '../../lib/account/errors';
import { deleteReturnPersonalAddress, deleteReturnStore, saveReturnNote, setDefaultReturnStore } from '../../lib/logistics/api';
import { NOTE_MAX, noteStatus, remainText } from '../../lib/logistics/returnNote';
import { STORE_LIMIT, storeAddressLine, storeTitle, type ReturnAddress, type ReturnStore } from '../../lib/logistics/returnStore';
import { useReturnSettings } from '../../lib/logistics/useReturnSettings';
import { useOnline } from '../../lib/useOnline';
import { RetryButton, SETTINGS_READ_TIMEOUT_MS, UnavailableBanner, VisibilityNote } from './logisticsParts';

type DeleteTarget = { kind: 'store'; store: ReturnStore } | { kind: 'personal' };

/** 物流設定 #/seller/logistics。目前只有「退貨地址」一個區塊（D1、D7）：超商退貨門市、個人地址、退貨說明 */
export default function SellerLogistics() {
  const toast = useToast();
  const online = useOnline();
  const { settings, phase, reload } = useReturnSettings({ timeoutMs: SETTINGS_READ_TIMEOUT_MS, refreshOnVisible: true });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [settingId, setSettingId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // 設預設、刪除後列表會重排或少一列，焦點要跟著走；等列表重讀完再移
  const [focusAfter, setFocusAfter] = useState<{ id: string } | null>(null);
  // 退貨說明：null＝沒動過，輸入框顯示已存的內容；有值＝草稿（背景重讀不會蓋掉它）
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteServerError, setNoteServerError] = useState<string | null>(null);

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    if (focusAfter) document.getElementById(focusAfter.id)?.focus();
  }, [focusAfter]);

  const stores = settings?.stores ?? [];
  const personal = settings?.personal ?? null;
  const full = stores.length >= STORE_LIMIT;

  const failToast = (e: unknown, fallback: string) => {
    toast(toAccountError(e).kind === 'auth' ? '登入已過期，請重新整理頁面並重新登入' : fallback, 'error');
  };

  const makeDefault = async (s: ReturnStore) => {
    if (settingId || !online) return;
    setHintId(null);
    setSettingId(s.id);
    try {
      await setDefaultReturnStore(s.id);
      await reload(true);
      toast('已設為預設門市');
      setFocusAfter({ id: `edit-store-${s.id}` });
    } catch (e) {
      if (toAccountError(e).code === 'RETURN_STORE_NOT_FOUND') {
        toast('這間門市已經被刪除', 'info');
        void reload(true);
      } else failToast(e, '設為預設失敗，請檢查網路後再試');
    } finally {
      setSettingId(null);
    }
  };

  const askDeleteStore = (s: ReturnStore) => {
    if (!online) return;
    if (s.is_default && stores.length > 1) { setHintId(s.id); return; }
    setHintId(null);
    setDeleting({ kind: 'store', store: s });
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    const target = deleting;
    setDeleteBusy(true);
    try {
      if (target.kind === 'store') {
        const at = stores.findIndex(r => r.id === target.store.id);
        const neighbour = stores[at + 1] ?? stores[at - 1] ?? null;
        await deleteReturnStore(target.store.id);
        await reload(true);
        toast('已刪除退貨門市');
        setFocusAfter({ id: neighbour ? `edit-store-${neighbour.id}` : 'add-store' });
      } else {
        await deleteReturnPersonalAddress();
        await reload(true);
        toast('已刪除個人地址');
        setFocusAfter({ id: 'add-personal' });
      }
    } catch (e) {
      const code = toAccountError(e).code;
      if (code === 'RETURN_STORE_NOT_FOUND') toast('這間門市已經被刪除', 'info');
      else if (code === 'RETURN_STORE_DEFAULT_PROTECTED') toast('預設門市不能刪除，請先把別筆設為預設', 'error');
      else failToast(e, '刪除失敗，請檢查網路後再試');
      void reload(true);
    } finally {
      setDeleting(null);
      setDeleteBusy(false);
    }
  };

  const savedNote = settings?.note ?? null;
  const note = noteStatus(noteDraft ?? savedNote ?? '', savedNote);
  const noteError = note.error ?? noteServerError;

  const saveNote = async () => {
    if (noteBusy || !online || !note.canSave) return;
    setNoteBusy(true);
    setNoteServerError(null);
    try {
      const res = await saveReturnNote(noteDraft ?? '');
      await reload(true);
      setNoteDraft(null);
      toast(res.note === null ? '已清除退貨說明' : '已儲存退貨說明');
    } catch (e) {
      const err = toAccountError(e);
      if (err.code === 'RETURN_NOTE_TOO_LONG' || err.code === 'RETURN_NOTE_INVALID') {
        setNoteServerError(err.message);
        document.getElementById('logi-note')?.focus();
      } else failToast(e, '儲存失敗，請檢查網路後再試');
    } finally {
      setNoteBusy(false);
    }
  };

  const loading = settings === null && phase === 'loading';

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Link to="/seller" aria-label="回到賣場總覽" className={`-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium md:hidden ${focusRing}`}>
        <ArrowLeft size={18} aria-hidden="true" />賣場總覽
      </Link>
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">物流設定</h1>

      <section aria-labelledby="logi-title" aria-busy={loading || undefined} className="rounded-lg bg-white p-4 md:p-5">
        <h2 id="logi-title" className="text-base font-bold">退貨地址</h2>

        {loading && (
          <div className="mt-4">
            <p role="status" className="sr-only">載入中</p>
            {[0, 1, 2].map(i => (
              <div key={i} aria-hidden="true" className={i === 0 ? '' : 'mt-6'}>
                <Bone className="h-5 w-32" />
                <Bone className="mt-3 h-4 w-full" />
                <Bone className="mt-2 h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {settings === null && phase === 'error' && (
          <div className="mt-4">
            {online ? (
              <Banner kind="error" title="讀不到退貨地址設定" actions={<RetryButton onRetry={reload} />}>請檢查網路後再試一次。</Banner>
            ) : (
              <Banner kind="warning" role="status" title="目前沒有網路" actions={<RetryButton onRetry={reload} />}>連上網路後才能看到退貨地址。</Banner>
            )}
          </div>
        )}

        {settings === null && phase === 'unavailable' && (
          <div className="mt-4"><UnavailableBanner onRetry={reload} /></div>
        )}

        {settings !== null && (
          <>
            <div className="mt-3">
              <VisibilityNote>這裡的資料會顯示給向你購買、訂單在運送中或已完成的買家，讓他們知道退貨要寄到哪裡。賣場頁和商品頁不會顯示。</VisibilityNote>
            </div>
            {!online && (
              <div className="mt-3">
                <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能新增、編輯、刪除或儲存。</Banner>
              </div>
            )}

            {/* 區塊一：超商退貨門市 */}
            <div className="mt-5">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <h3 className="text-base font-medium">超商退貨門市</h3>
                  {stores.length > 0 && (
                    <p className={`text-sm ${full ? 'font-medium' : 'text-muted'}`}>
                      {full ? `最多 ${STORE_LIMIT} 間，已存滿。刪除一間後才能新增。` : `已存 ${stores.length} / ${STORE_LIMIT} 間`}
                    </p>
                  )}
                </div>
                {stores.length > 0 && <AddAction id="add-store" to="/seller/logistics/stores/new" disabled={full || !online}>新增門市</AddAction>}
              </div>

              {stores.length === 0 && (
                <>
                  <p className="mt-1 text-sm text-muted">還沒有退貨門市。買家要退貨時，可以把商品寄到你設定的超商門市。</p>
                  <div className="mt-3">
                    <AddAction id="add-store" to="/seller/logistics/stores/new" disabled={!online} primary>新增門市</AddAction>
                  </div>
                </>
              )}

              {stores.length > 0 && (
                <ul aria-label="超商退貨門市" className="mt-1 divide-y divide-line">
                  {stores.map(s => {
                    const title = storeTitle(s);
                    const protectedDefault = s.is_default && stores.length > 1;
                    return (
                      <li key={s.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 break-words text-base font-medium">{title}</p>
                          {s.is_default && <DefaultTag />}
                        </div>
                        <p className="mt-1 text-sm leading-6">{storeAddressLine(s)}</p>
                        <p className="text-sm leading-6 text-muted">收件人 {s.recipient}　<span className="whitespace-nowrap">{formatPhone(s.phone)}</span></p>
                        <div className="-mb-2 -ml-2 mt-1 flex flex-wrap items-center">
                          {online ? (
                            <Link id={`edit-store-${s.id}`} to={`/seller/logistics/stores/${s.id}`} aria-label={`編輯，${title}`} className={textActionCls}>編輯</Link>
                          ) : (
                            <button id={`edit-store-${s.id}`} type="button" aria-disabled="true" aria-label={`編輯，${title}`} className={`${textActionCls} text-muted`}>編輯</button>
                          )}
                          {!s.is_default && (
                            <button
                              type="button" aria-label={`設為預設，${title}`}
                              aria-disabled={!online || settingId !== null || undefined} aria-busy={settingId === s.id || undefined}
                              onClick={() => void makeDefault(s)}
                              className={`${textActionCls} ${!online ? 'text-muted' : ''}`}
                            >
                              {settingId === s.id && <Spinner size={14} />}
                              <span className={settingId === s.id ? 'ml-1' : ''}>{settingId === s.id ? '設定中…' : '設為預設'}</span>
                            </button>
                          )}
                          <button
                            type="button" aria-label={`刪除，${title}`}
                            aria-disabled={!online || protectedDefault || undefined}
                            onClick={() => askDeleteStore(s)}
                            className={`${textActionCls} ml-auto ${!online || protectedDefault ? 'text-muted' : 'text-error-text'}`}
                          >
                            刪除
                          </button>
                        </div>
                        {hintId === s.id && (
                          <p role="status" className="mt-2 flex items-start gap-1.5 rounded-sm bg-subtle p-2.5 text-sm">
                            <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
                            <span>預設門市不能直接刪除。請先把別筆設為預設，再刪除這一筆。</span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 區塊二：個人地址 */}
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="text-base font-medium">個人地址</h3>
              {personal ? (
                <>
                  <p className="text-sm text-muted">買家選擇宅配寄回時，會看到這個地址。</p>
                  <PersonalRow a={personal} online={online} onDelete={() => { if (online) setDeleting({ kind: 'personal' }); }} />
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted">還沒有個人地址。買家選擇宅配寄回時，會看到這個地址。</p>
                  <div className="mt-3">
                    <AddAction id="add-personal" to="/seller/logistics/address" disabled={!online}>新增個人地址</AddAction>
                  </div>
                </>
              )}
            </div>

            {/* 區塊三：退貨說明 */}
            <div className="mt-5 border-t border-line pt-5">
              <h3 id="logi-note-title" className="text-base font-medium">退貨說明<span className="font-normal text-muted">（選填）</span></h3>
              <textarea
                id="logi-note" rows={4} value={noteDraft ?? savedNote ?? ''} placeholder="例：聯絡方式、退貨規則"
                readOnly={noteBusy || undefined} aria-busy={noteBusy || undefined}
                aria-labelledby="logi-note-title"
                aria-invalid={noteError ? true : undefined}
                aria-describedby={['logi-note-help', noteError ? 'logi-note-err' : ''].filter(Boolean).join(' ')}
                onChange={e => { setNoteDraft(e.target.value); setNoteServerError(null); }}
                className={`mt-2 scroll-mt-20 max-[239px]:min-h-44 ${fieldCls(Boolean(noteError), 'textarea')}`}
              />
              <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 text-sm text-muted">
                <p id="logi-note-help" className="min-w-40 flex-1">買家會在退貨資訊下方看到這段文字。可以寫聯絡方式或退貨規則，最多 {NOTE_MAX} 字，可以換行。</p>
                <span aria-hidden="true" className={`shrink-0 tabular-nums ${note.remaining <= 20 ? 'font-medium' : ''} ${note.remaining < 0 ? 'text-error-text' : note.remaining <= 20 ? 'text-ink' : ''}`}>{remainText(note.remaining)}</span>
              </div>
              <FieldError id="logi-note-err">{noteError ?? undefined}</FieldError>
              {!online && <p role="status" className="mt-2 text-sm text-muted">目前沒有網路，連上網路後才能儲存。</p>}
              <p role="status" className="sr-only">{noteBusy ? '正在儲存退貨說明' : ''}</p>
              <button
                type="button" aria-busy={noteBusy || undefined}
                aria-disabled={noteBusy || !online || !note.canSave || undefined}
                onClick={() => void saveNote()}
                className={`mt-3 w-full min-[400px]:w-auto ${pressCls} ${noteBusy ? savingBtn : online && note.canSave ? btnPrimary : `${btnOutline} text-muted`}`}
              >
                {noteBusy && <Spinner />}
                {noteBusy ? '儲存中…' : '儲存退貨說明'}
              </button>
            </div>
          </>
        )}
      </section>

      {deleting && (
        <LeaveDialog
          title={deleting.kind === 'store' ? `刪除 ${storeTitle(deleting.store)}？` : '刪除個人地址？'}
          description={deleteDescription(deleting, stores.length, personal !== null)}
          stayLabel="取消" leaveLabel="刪除" busy={deleteBusy} busyLabel="刪除中…"
          offlineNotice={online ? undefined : '目前沒有網路，連上網路後才能刪除。'}
          onStay={() => setDeleting(null)} onLeave={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

/** 刪除確認的內文（設計 4.4 五列，逐字） */
function deleteDescription(t: DeleteTarget, storeCount: number, hasPersonal: boolean): string {
  if (t.kind === 'personal') {
    return storeCount > 0
      ? '刪除後無法復原。買家選擇宅配寄回時會看不到地址。'
      : '刪除後無法復原。你也還沒有設定退貨門市，買家會看到「賣家尚未提供退貨地址」。';
  }
  if (storeCount > 1) return '刪除後無法復原。買家看到的預設門市不會改變。';
  return hasPersonal
    ? '這是你唯一的退貨門市，刪除後無法復原。買家退貨時會看不到超商門市。'
    : '這是你唯一的退貨門市，刪除後無法復原。你也還沒有設定個人地址，買家會看到「賣家尚未提供退貨地址」。';
}

/** 「新增…」：可用時是連結，滿了或離線時是 aria-disabled 的按鈕（按了沒反應，說明已常駐在頁面上） */
function AddAction({ id, to, disabled, primary = false, children }: {
  id: string; to: string; disabled: boolean; primary?: boolean; children: string;
}) {
  if (disabled) {
    return (
      <button id={id} type="button" aria-disabled="true" className={`${btnOutline} shrink-0 text-muted ${pressCls}`}>
        <Plus size={16} aria-hidden="true" />{children}
      </button>
    );
  }
  return (
    <Link id={id} to={to} className={`${primary ? btnPrimary : btnOutline} shrink-0 ${pressCls}`}>
      <Plus size={16} aria-hidden="true" />{children}
    </Link>
  );
}

function PersonalRow({ a, online, onDelete }: { a: ReturnAddress; online: boolean; onDelete: () => void }) {
  return (
    <div className="py-3">
      <p className="text-base">
        <span className="break-words font-medium">{a.recipient}</span>　<span className="whitespace-nowrap text-sm text-muted">{formatPhone(a.phone)}</span>
      </p>
      <p className="mt-1 text-sm leading-6">{storeAddressLine(a)}</p>
      <div className="-mb-2 -ml-2 mt-1 flex flex-wrap items-center">
        {online ? (
          <Link id="edit-personal" to="/seller/logistics/address" aria-label="編輯個人地址" className={textActionCls}>編輯</Link>
        ) : (
          <button id="edit-personal" type="button" aria-disabled="true" aria-label="編輯個人地址" className={`${textActionCls} text-muted`}>編輯</button>
        )}
        <button
          type="button" aria-label="刪除個人地址" aria-disabled={!online || undefined} onClick={onDelete}
          className={`${textActionCls} ml-auto ${online ? 'text-error-text' : 'text-muted'}`}
        >
          刪除
        </button>
      </div>
    </div>
  );
}
