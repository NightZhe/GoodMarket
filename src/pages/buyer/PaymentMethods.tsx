import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Info, Plus } from 'lucide-react';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import { Bone, SubHeader, SubPage, Spinner, pressCls, textActionCls } from '../../components/account/ui';
import CardLabel from '../../components/payment/CardLabel';
import { CARD_LIMIT } from '../../lib/payment/limits';
import { deleteMethod, errorCodeOf, setDefaultMethod } from '../../lib/payment/api';
import { brandLabel, cardBrandOf, expiryOf } from '../../lib/payment/cards';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { useCards } from '../../lib/payment/useCards';
import type { PaymentMethodRow } from '../../lib/payment/types';
import { useOnline } from '../../lib/useOnline';

const READ_TIMEOUT_MS = 10_000;
const NO_FULL_CARD = '卡號只輸入在綠界科技的畫面，好物集不會儲存完整卡號。';

/** 付款方式 #/account/payment-methods（S-2）。本版只有信用卡 */
export default function PaymentMethods() {
  return (
    <LoginRequired kind="account">
      <MethodsView />
    </LoginRequired>
  );
}

const cardText = (c: PaymentMethodRow) => `${brandLabel(cardBrandOf(c))} 末四碼 ${c.card4}`;

function MethodsView() {
  const toast = useToast();
  const online = useOnline();
  const { enabled, ready } = usePaymentConfig();
  const { rows, phase, reload } = useCards({ timeoutMs: READ_TIMEOUT_MS, refreshOnReturn: true });
  const [settingId, setSettingId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PaymentMethodRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // 列表重排或刪除後焦點要跟著走，不能停在消失的位置；等列表重讀完再移
  const [focusAfter, setFocusAfter] = useState<{ id: string | null } | null>(null);
  const emptyTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusAfter || rows === null) return;
    if (focusAfter.id) document.getElementById(`del-${focusAfter.id}`)?.focus();
    else emptyTitle.current?.focus();
    setFocusAfter(null);
  }, [focusAfter, rows]);

  const retry = async () => { setRetrying(true); await reload(); setRetrying(false); };

  const makeDefault = async (c: PaymentMethodRow) => {
    if (settingId || !online) return;
    setHintId(null);
    setSettingId(c.id);
    try {
      await setDefaultMethod(c.id);
      await reload(true);
      toast('已設為預設卡');
      setFocusAfter({ id: c.id });
    } catch (e) {
      if (errorCodeOf(e) === 'CARD_NOT_FOUND') { toast('這張卡已經被刪除', 'info'); void reload(true); }
      else toast('設為預設失敗，請檢查網路後再試', 'error');
    } finally {
      setSettingId(null);
    }
  };

  const askDelete = (c: PaymentMethodRow) => {
    if (!online) return;
    if (c.is_default && (rows?.length ?? 0) > 1) { setHintId(c.id); return; }
    setHintId(null);
    setDeleting(c);
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy || rows === null) return;
    const target = deleting;
    const at = rows.findIndex(r => r.id === target.id);
    const neighbour = rows[at + 1] ?? rows[at - 1] ?? null;
    setDeleteBusy(true);
    try {
      await deleteMethod(target.id); // deleted、revoking（已隱藏、不能再扣款，伺服器稍後向綠界撤銷）都當成功
      await reload(true);
      toast('已刪除信用卡');
      setFocusAfter({ id: neighbour?.id ?? null });
    } catch (e) {
      const code = errorCodeOf(e);
      if (code === 'CARD_NOT_FOUND') toast('這張卡已經被刪除', 'info');
      else if (code === 'DEFAULT_CARD_CANNOT_DELETE') toast('預設的卡不能直接刪除，請先把別張設為預設', 'error');
      else if (code === 'PAYMENT_IN_PROGRESS') toast('這張卡正在付款，付款完成後才能刪除', 'error');
      else toast('刪除失敗，請檢查網路後再試', 'error');
      void reload(true);
    } finally {
      setDeleting(null);
      setDeleteBusy(false);
    }
  };

  const full = rows !== null && rows.length >= CARD_LIMIT;
  const canAdd = !full && online && enabled;

  return (
    <SubPage>
      <SubHeader to="/account" backLabel="回到我的帳號" title="付款方式" />

      {rows === null && phase === 'loading' && (
        <>
          <h2 className="sr-only">信用卡</h2>
          <ul aria-busy="true" aria-label="我的信用卡" className="mt-2 divide-y divide-line bg-white md:mt-3 md:rounded-md">
            <li className="sr-only" role="status">載入中</li>
            {[0, 1, 2].map(i => (
              <li key={i} aria-hidden="true" className="flex gap-3 px-4 py-4 md:px-6">
                <Bone className="h-9 w-12" />
                <span className="flex-1"><Bone className="h-4 w-40" /><Bone className="mt-2 h-3 w-24" /></span>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows === null && phase === 'error' && (
        <div className="mt-2 bg-white p-4 md:mt-3 md:rounded-md md:p-6">
          {online ? (
            <Banner kind="error" title="讀不到你的信用卡" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>請檢查網路後再試一次。</Banner>
          ) : (
            <Banner kind="warning" role="status" title="目前沒有網路" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>連上網路後才能看到你的信用卡。</Banner>
          )}
        </div>
      )}

      {rows !== null && ready && !enabled && (
        <div className="mt-2 px-2 md:mt-3 md:px-0">
          <Banner kind="info" role="status" title="線上付款暫時停用">目前結帳只能用貨到付款，暫時不能新增信用卡。已綁的卡會保留，恢復後就能再用。</Banner>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="mt-2 flex flex-col items-center bg-white px-6 py-12 text-center md:mt-3 md:rounded-md">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><CreditCard size={28} /></span>
          <h2 ref={emptyTitle} tabIndex={-1} className="mt-4 text-base font-medium outline-none">還沒有綁定的信用卡</h2>
          <p className="mt-1 text-sm text-muted text-pretty">綁定後，結帳時直接選這張卡付款，不用每次輸入卡號。</p>
          <p className="mt-2 text-sm text-muted text-pretty">{NO_FULL_CARD}</p>
          {canAdd ? (
            <Link to="/account/payment-methods/new" className={`${btnPrimary} mt-5 h-12 px-6 text-base ${pressCls}`}>
              <Plus size={16} aria-hidden="true" />新增信用卡
            </Link>
          ) : (
            <button type="button" aria-disabled="true" className={`${btnOutline} mt-5 h-12 px-6 text-base text-muted`}>
              <Plus size={16} aria-hidden="true" />新增信用卡
            </button>
          )}
          {!online && <p role="status" className="mt-2 text-sm text-muted">目前沒有網路，連上網路後才能新增。</p>}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <h2 className="px-4 pb-2 pt-5 text-sm font-bold md:px-0 md:pt-6">信用卡</h2>
          {!online && (
            <div className="mb-2 px-2 md:mb-3 md:px-0">
              <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能新增、刪除或設為預設。</Banner>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-white px-4 py-3 md:rounded-md md:px-6">
            <p className={`min-w-0 text-sm ${full ? 'font-medium' : 'text-muted'}`}>
              {full ? `已綁 ${rows.length} / ${CARD_LIMIT} 張，已達上限。刪除一張後才能新增。` : `已綁 ${rows.length} / ${CARD_LIMIT} 張`}
            </p>
            {canAdd ? (
              <Link to="/account/payment-methods/new" className={`${btnPrimary} shrink-0 ${pressCls}`}>
                <Plus size={16} aria-hidden="true" />新增信用卡
              </Link>
            ) : (
              <button type="button" aria-disabled="true" className={`${btnOutline} shrink-0 text-muted`}>
                <Plus size={16} aria-hidden="true" />新增信用卡
              </button>
            )}
          </div>

          <ul aria-label="我的信用卡" className="mt-2 divide-y divide-line bg-white md:mt-3 md:overflow-hidden md:rounded-md">
            {rows.map(c => {
              const expired = c.expired || expiryOf(c.exp_year, c.exp_month).expired;
              const protectedDefault = c.is_default && rows.length > 1;
              return (
                <li key={c.id} className="px-4 pb-3 pt-4 md:px-6">
                  <CardLabel card={c} variant="row" />
                  <div className="-mb-2 -ml-2 mt-1 flex flex-wrap items-center">
                    {!c.is_default && !expired && (
                      <button
                        type="button" aria-label={`把 ${cardText(c)} 設為預設`}
                        aria-disabled={!online || settingId !== null || undefined} aria-busy={settingId === c.id || undefined}
                        onClick={() => void makeDefault(c)}
                        className={`${textActionCls} ${!online ? 'text-muted' : ''}`}
                      >
                        {settingId === c.id && <Spinner size={14} />}
                        <span className={settingId === c.id ? 'ml-1' : ''}>{settingId === c.id ? '設定中…' : '設為預設'}</span>
                      </button>
                    )}
                    <button
                      id={`del-${c.id}`} type="button" aria-label={`刪除 ${cardText(c)}`}
                      aria-disabled={!online || protectedDefault || undefined}
                      onClick={() => askDelete(c)}
                      className={`${textActionCls} ml-auto ${!online || protectedDefault ? 'text-muted' : 'text-error-text'}`}
                    >
                      刪除
                    </button>
                  </div>
                  {hintId === c.id && (
                    <p role="status" className="mt-2 flex items-start gap-1.5 rounded-sm bg-subtle p-2.5 text-sm">
                      <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
                      <span>預設的卡不能直接刪除。先把別張設為預設，再刪除這一張。</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-2 bg-white px-4 py-3 md:mt-3 md:rounded-md md:px-6">
            <p className="text-sm text-muted">{NO_FULL_CARD}</p>
            <Link to="/privacy" className="-mb-2 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-2">隱私政策</Link>
          </div>
        </>
      )}

      {deleting && (
        <LeaveDialog
          title={`刪除 ${cardText(deleting)}？`}
          description={(rows?.length ?? 0) <= 1
            ? '這是你唯一的一張卡。刪除後，下次結帳要重新綁定，或選貨到付款。'
            : '刪除後，結帳就不能用這張卡付款；要再用的話，需要重新綁定。'}
          stayLabel="取消" leaveLabel="刪除" busy={deleteBusy} busyLabel="處理中…"
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
