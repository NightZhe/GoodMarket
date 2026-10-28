import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info, Landmark, Plus } from 'lucide-react';
import Banner from '../import/Banner';
import LeaveDialog from '../import/LeaveDialog';
import { btnOutline, btnPrimary } from '../import/ui';
import { useToast } from '../Toast';
import { Bone, Spinner, pressCls, sectionTitleCls, textActionCls } from '../account/ui';
import BankLogo from './BankLogo';
import { PayoutChip, StatusChip } from './BankStatusChips';
import { deleteBankAccount, errorCodeOf, isAuthError } from '../../lib/payment/api';
import {
  FULL_ACCOUNT_NOTE, LIMIT_TEXT, PAYOUT_NO_DELETE_MANY, PAYOUT_NO_DELETE_ONLY, REJECTED_FALLBACK_REASON, UNAVAILABLE_BODY, UNAVAILABLE_TITLE,
  accountTitle, bankErrorText, last4Spoken, lacksPayout, type BankAccount,
} from '../../lib/payment/bankAccount';
import { clearBankDone, peekBankDone } from '../../lib/payment/bankDone';
import { FROM_A, flowBase, verifyPath, type BankOrigin } from '../../lib/payment/bankRoutes';
import { useBankAccounts } from '../../lib/payment/useBankAccounts';

const READ_TIMEOUT_MS = 10_000;

/** 頁 A 的銀行帳號區（設計 3）。信用卡區在它上面，兩區互不影響：這裡讀不到，信用卡照常 */
export default function BankAccountsSection({ origin, online, focusTitle }: { origin: BankOrigin; online: boolean; focusTitle: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, phase, reload, setList } = useBankAccounts({ timeoutMs: READ_TIMEOUT_MS, refreshOnReturn: true });
  const [retrying, setRetrying] = useState(false);
  const [hintId, setHintId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ id: string | null } | null>(null);
  const [titleDone, setTitleDone] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emptyTitle = useRef<HTMLHeadingElement>(null);

  // 流程頁完成後交來的訊息只顯示一次：進來時記下，顯示後立刻清掉
  const [done] = useState(peekBankDone);
  useEffect(() => {
    if (!done) return;
    toast(done.toast, done.kind ?? 'success');
    setFocusTarget({ id: done.focusId });
    clearBankDone();
  }, [done, toast]);

  // 列表重排或刪除後焦點要跟著走；等列表重讀完再移
  useEffect(() => {
    if (!focusTarget || data === null) return;
    const el = focusTarget.id ? document.getElementById(`bank-title-${focusTarget.id}`) : (emptyTitle.current ?? titleRef.current);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
    setFocusTarget(null);
  }, [focusTarget, data]);

  // 從賣家入口（?section=bank）進來：讀完就捲到銀行帳號區並把焦點放到它的標題
  useEffect(() => {
    if (!focusTitle || titleDone || phase === 'loading' || done) return;
    setTitleDone(true);
    titleRef.current?.scrollIntoView?.({ block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle, titleDone, phase, done]);

  const retry = async () => { setRetrying(true); await reload(); setRetrying(false); };

  const rows = data?.accounts ?? null;
  const limit = data?.limit ?? 5;
  const full = rows !== null && rows.length >= limit;
  const base = flowBase(origin);

  const goAdd = () => {
    if (!online || full || rows === null) return;
    navigate(rows.length === 0 ? `${base}/new/bank` : verifyPath(origin, 'add'), { state: FROM_A });
  };

  const askDelete = (a: BankAccount) => {
    if (!online) return;
    if (a.isPayout) { setHintId(a.id); return; }
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
      setList(await deleteBankAccount(target.id));
      toast('已刪除銀行帳號');
      setFocusTarget({ id: neighbour?.id ?? null });
    } catch (e) {
      const code = errorCodeOf(e);
      if (isAuthError(e)) toast(bankErrorText('NOT_AUTHENTICATED', ''), 'error');
      else if (code === 'BANK_ACCOUNT_NOT_FOUND') { toast('這個帳號已經不存在', 'info'); void reload(true); }
      else if (code === 'PAYOUT_ACCOUNT_CANNOT_DELETE') { toast(bankErrorText(code, ''), 'error'); void reload(true); }
      else toast('刪除失敗，請檢查網路後再試', 'error');
    } finally {
      setDeleting(null);
      setDeleteBusy(false);
    }
  };

  const head = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 pr-5">
      <h2 id="bank-title" ref={titleRef} tabIndex={-1} className={`${sectionTitleCls} outline-none`}>銀行帳號</h2>
      {rows !== null && rows.length > 0 && (
        <p className={`pt-6 text-footnote ${full ? 'font-medium text-ink' : 'text-muted'}`}>已綁 {rows.length} / {limit}</p>
      )}
    </div>
  );

  if (phase === 'unavailable') {
    return (
      <section aria-labelledby="bank-title">
        {head}
        <Banner kind="info" role="status" title={UNAVAILABLE_TITLE}>{UNAVAILABLE_BODY}</Banner>
      </section>
    );
  }

  if (rows === null && phase === 'loading') {
    return (
      <section aria-labelledby="bank-title">
        {head}
        <ul aria-busy="true" aria-label="我的銀行帳號" className="divide-y-[0.5px] divide-separator overflow-hidden rounded-card bg-white">
          <li className="sr-only" role="status">載入中</li>
          {[0, 1, 2].map(i => (
            <li key={i} aria-hidden="true" className="flex gap-2 px-4 py-4">
              <Bone className="h-6 w-6" />
              <span className="flex-1"><Bone className="h-4 w-40" /><Bone className="mt-2 h-3 w-24" /></span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (rows === null) {
    return (
      <section aria-labelledby="bank-title">
        {head}
        <div className="rounded-card bg-white p-4">
          {online ? (
            <Banner kind="error" title="讀不到你的銀行帳號" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>請檢查網路後再試一次。</Banner>
          ) : (
            <Banner kind="warning" role="status" title="目前沒有網路" actions={<RetryButton busy={retrying} onClick={() => void retry()} />}>連上網路後才能看到你的銀行帳號。</Banner>
          )}
        </div>
      </section>
    );
  }

  const offlineBanner = !online && (
    <div className="mb-2">
      <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能新增、刪除或設為撥款帳號。</Banner>
    </div>
  );

  if (rows.length === 0) {
    return (
      <section aria-labelledby="bank-title">
        {head}
        {offlineBanner}
        <div className="flex flex-col items-center rounded-card bg-white px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><Landmark size={28} /></span>
          <h3 ref={emptyTitle} tabIndex={-1} className="mt-4 text-base font-medium outline-none">還沒有銀行帳號</h3>
          <p className="mt-1 text-sm text-muted text-pretty">綁定後，開店收款時用來把款項撥給你。</p>
          <p className="mt-2 text-footnote text-muted text-pretty">{FULL_ACCOUNT_NOTE}</p>
          <Link to="/privacy" className="inline-flex min-h-11 items-center text-footnote text-ink underline underline-offset-2">隱私政策</Link>
          <button
            type="button" onClick={goAdd} aria-disabled={!online || undefined}
            className={`${online ? btnPrimary : `${btnOutline} text-muted`} mt-3 h-12 px-6 text-base ${pressCls}`}
          >
            <Plus size={16} aria-hidden="true" />新增銀行帳號
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="bank-title">
      {head}
      {offlineBanner}
      {lacksPayout(rows) && (
        <div className="mb-2">
          <Banner kind="warning" role="status" title="目前沒有撥款帳號">請新增正確的銀行帳號，或把其他帳號設為撥款帳號。</Banner>
        </div>
      )}
      <p className="px-5 pb-2 text-footnote text-muted">撥款會匯到「撥款帳號」。新帳號要等第一次撥款成功才算「已驗證」。</p>

      <ul aria-label="我的銀行帳號" className="divide-y-[0.5px] divide-separator overflow-hidden rounded-card bg-white">
        {rows.map(a => (
          <li key={a.id} role="group" aria-labelledby={`bank-title-${a.id}`} className="px-4 pb-3 pt-4">
            <div className="flex items-start gap-2">
              <BankLogo code={a.bankCode} size={24} />
              <p id={`bank-title-${a.id}`} tabIndex={-1} className="min-w-0 flex-1 text-headline font-semibold outline-none [overflow-wrap:anywhere]">{a.bankName}</p>
            </div>
            <p className="mt-0.5 text-subhead [overflow-wrap:anywhere]">
              {a.branchName && <>{a.branchName} · </>}
              <span aria-hidden="true" className="tabular-nums">末四碼 {a.last4}</span>
              <span className="sr-only">{last4Spoken(a.last4)}</span>
            </p>
            <p className="text-footnote text-muted [overflow-wrap:anywhere]">戶名 {a.holder}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {a.isPayout ? <PayoutChip /> : <span className="sr-only">一般帳號</span>}
              <StatusChip status={a.status} />
            </div>
            {a.status === 'rejected' && (
              <p className="mt-1 text-footnote text-ink [overflow-wrap:anywhere]">未通過原因：{a.reason || REJECTED_FALLBACK_REASON}</p>
            )}
            <div className="-mb-2 -ml-2 mt-1 flex flex-wrap items-center">
              {!a.isPayout && a.status !== 'rejected' && (
                <button
                  type="button" aria-label={`把 ${a.bankName} ${last4Spoken(a.last4)} 設為撥款帳號`} aria-disabled={!online || undefined}
                  onClick={() => { if (online) navigate(verifyPath(origin, 'payout', a.id), { state: FROM_A }); }}
                  className={`${textActionCls} ${!online ? 'text-muted' : 'text-brand'}`}
                >
                  設為撥款帳號
                </button>
              )}
              <button
                id={`bank-del-${a.id}`} type="button" aria-label={`刪除 ${a.bankName} ${last4Spoken(a.last4)}`}
                aria-disabled={!online || a.isPayout || undefined}
                onClick={() => askDelete(a)}
                className={`${textActionCls} ml-auto ${!online || a.isPayout ? 'text-muted' : 'text-error-text'}`}
              >
                刪除
              </button>
            </div>
            {hintId === a.id && (
              <p role="status" className="mt-2 flex items-start gap-1.5 rounded-sm bg-subtle p-2.5 text-sm">
                <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
                <span>{rows.length > 1 ? PAYOUT_NO_DELETE_MANY : PAYOUT_NO_DELETE_ONLY}</span>
              </p>
            )}
          </li>
        ))}
        <li>
          <button
            type="button" onClick={goAdd} aria-disabled={!online || full || undefined}
            className={`flex min-h-12 w-full items-center gap-2 px-4 text-left text-body font-medium ${pressCls} ${!online || full ? 'text-muted' : 'text-brand'}`}
          >
            <Plus size={18} aria-hidden="true" />新增銀行帳號
          </button>
        </li>
      </ul>
      {full && <p role="status" className="px-5 pt-2 text-footnote text-muted">{LIMIT_TEXT}</p>}
      <p className="px-5 pt-2 text-footnote text-muted">{FULL_ACCOUNT_NOTE}</p>

      {deleting && (
        <LeaveDialog
          title={`刪除 ${accountTitle(deleting)}？`}
          description="刪除後不能復原。要再用的話，需要重新新增。"
          stayLabel="取消" leaveLabel="刪除" busy={deleteBusy} busyLabel="處理中…"
          offlineNotice={online ? undefined : '目前沒有網路，連上網路後才能刪除。'}
          onStay={() => setDeleting(null)} onLeave={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

function RetryButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={btnOutline} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) onClick(); }}>
      {busy ? <><Spinner size={14} />重試中…</> : '重試'}
    </button>
  );
}
