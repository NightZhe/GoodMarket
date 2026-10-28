import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { Bone, SubHeader, SubPage, Spinner, pressCls } from '../../components/account/ui';
import StepUpVerify from '../../components/payment/StepUpVerify';
import { useBankFlow } from './BankFlow';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import { phoneOf } from '../../lib/auth/identity';
import { errorCodeOf, isAuthError, setPayoutBankAccount } from '../../lib/payment/api';
import {
  PHONE_REQUIRED_ADD_TEXT, PHONE_REQUIRED_PAYOUT_TEXT, bankErrorText, last4Spoken, type BankAccount,
} from '../../lib/payment/bankAccount';
import { pageAPath, type VerifyPurpose } from '../../lib/payment/bankRoutes';
import { clearFlow, flowStore } from '../../lib/auth/phoneFlow';

/**
 * 簡訊再驗證（設計 6）：新增第 2 筆以後、把一般帳號設為撥款帳號之前。
 * ?for=add 通過後進選銀行（填到一半過期的話回到填資料頁）；?for=payout&id=… 通過後立即設為撥款帳號並回頁 A
 */
export default function BankVerify() {
  const [params] = useSearchParams();
  const purpose: VerifyPurpose | null = params.get('for') === 'add' ? 'add' : params.get('for') === 'payout' ? 'payout' : null;
  const id = params.get('id');
  const flow = useBankFlow();
  if (!purpose || (purpose === 'payout' && !id)) return <Navigate to={pageAPath(flow.origin)} replace />;
  return <VerifyView purpose={purpose} id={id} />;
}

function VerifyView({ purpose, id }: { purpose: VerifyPurpose; id: string | null }) {
  const { origin, base, draft, accounts, phase, reload, setList, leaveToA } = useBankFlow();
  const { user } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const { state } = useLocation() as { state: { notice?: string } | null };
  const national = user ? phoneOf(user) : null;
  const [finishing, setFinishing] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [failText, setFailText] = useState('');
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const target: BankAccount | null = purpose === 'payout' ? (accounts?.accounts.find(a => a.id === id) ?? null) : null;
  const current = accounts?.accounts.find(a => a.isPayout) ?? null;

  // 要設的帳號已經不在了、或已是撥款帳號、或未通過：不用驗證，回列表說一聲
  useEffect(() => {
    if (purpose !== 'payout' || accounts === null || finishing !== 'idle') return;
    if (!target) { toast('這個帳號已經不存在', 'info'); leaveToA(); }
    else if (target.status === 'rejected') { toast(bankErrorText('BANK_ACCOUNT_REJECTED', ''), 'error'); leaveToA(); }
    else if (target.isPayout) leaveToA();
  }, [purpose, accounts, target, finishing, leaveToA, toast]);

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  const header = (
    <SubHeader to={pageAPath(origin)} backText="取消" backLabel="取消" title="驗證手機" onBack={e => { e.preventDefault(); clearFlow(flowStore()); leaveToA(); }} />
  );

  // 新增也要知道目前筆數，才能判斷第一筆不用驗證
  if (accounts === null) {
    return (
      <SubPage noTabBar>
        {header}
        {phase === 'error' ? (
          <Banner kind="error" title="讀不到你的銀行帳號" actions={<button type="button" className={btnOutline} onClick={() => void reload()}>重試</button>}>請檢查網路後再試一次。</Banner>
        ) : (
          <div aria-busy="true" role="status"><span className="sr-only">載入中</span><Bone className="mt-3 h-32 w-full" /></div>
        )}
      </SubPage>
    );
  }

  // 第一筆不需要簡訊（Q6）：直接去選銀行
  if (purpose === 'add' && accounts !== null && accounts.accounts.length === 0) return <Navigate to={`${base}/new/bank`} replace />;
  if (purpose === 'payout' && !target) return <SubPage noTabBar>{header}</SubPage>;

  const afterVerified = async () => {
    if (purpose === 'add') {
      navigate(draft.bankCode ? `${base}/new` : `${base}/new/bank`, { replace: true });
      return;
    }
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setFinishing('busy');
    try {
      setList(await setPayoutBankAccount(id));
      leaveToA({ toast: '已設為撥款帳號', focusId: id });
    } catch (e) {
      const code = errorCodeOf(e);
      if (isAuthError(e)) { leaveToA(); return; }
      if (code === 'BANK_ACCOUNT_NOT_FOUND') { toast('這個帳號已經不存在', 'info'); void reload(true); leaveToA(); return; }
      if (code === 'BANK_ACCOUNT_REJECTED') { toast(bankErrorText(code, ''), 'error'); void reload(true); leaveToA(); return; }
      setFailText(code === 'STEP_UP_REQUIRED' ? '驗證已過期，請重新驗證。' : bankErrorText(code, '設為撥款帳號失敗，請檢查網路後再試一次。'));
      setFinishing('failed');
    } finally {
      busyRef.current = false;
    }
  };

  if (finishing !== 'idle') {
    return (
      <SubPage noTabBar>
        {header}
        <div className="mt-3 rounded-card bg-white p-4">
          {finishing === 'busy' ? (
            <p role="status" className="flex items-center gap-2 text-sm"><Spinner />正在設為撥款帳號…</p>
          ) : (
            <Banner kind="error" title="設為撥款帳號失敗" actions={
              <>
                <button type="button" className={btnPrimary} onClick={() => void afterVerified()}>重試</button>
                <button type="button" className={btnOutline} onClick={() => leaveToA()}>回到列表</button>
              </>
            }>{failText}</Banner>
          )}
        </div>
      </SubPage>
    );
  }

  const summary = purpose === 'add' ? (
    <>
      <h2 ref={titleRef} tabIndex={-1} className="text-headline font-semibold outline-none">新增銀行帳號前，先確認是你本人</h2>
      <p className="mt-1 text-sm">我們會傳驗證碼簡訊到你帳號上綁定的手機。</p>
    </>
  ) : target && (
    <>
      <h2 ref={titleRef} tabIndex={-1} className="text-headline font-semibold outline-none">把這個帳號設為撥款帳號</h2>
      <p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{target.bankName}</p>
      <p className="text-sm [overflow-wrap:anywhere]">
        {target.branchName && <>{target.branchName} · </>}
        <span aria-hidden="true" className="tabular-nums">末四碼 {target.last4}</span>
        <span className="sr-only">{last4Spoken(target.last4)}</span>
      </p>
      <p className="mt-1 text-sm">下一次撥款會匯到這個帳號。</p>
      {current && current.id !== target.id && <p className="mt-1 text-sm">目前的撥款帳號（{current.bankName} 末四碼 {current.last4}）會變成一般帳號。</p>}
      {target.status === 'pending' && <p className="mt-1 text-sm">這個帳號還沒驗證過，第一次撥款成功才算通過，請先確認帳號正確。</p>}
    </>
  );

  return (
    <SubPage noTabBar>
      {header}
      {(national || purpose === 'payout') && <div className="mt-3 rounded-card bg-white p-4">{summary}</div>}
      <section className="mt-2 rounded-card bg-white p-4">
        {national ? (
          <StepUpVerify
            national={national} notice={state?.notice} exitLabel="取消" hideTitle
            onVerified={() => void afterVerified()} onCancel={() => leaveToA()}
          />
        ) : (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><Smartphone size={28} /></span>
            <h2 className="mt-4 text-base font-medium">要先綁定手機</h2>
            <p className="mt-1 text-sm text-muted text-pretty">{purpose === 'add' ? PHONE_REQUIRED_ADD_TEXT : PHONE_REQUIRED_PAYOUT_TEXT}</p>
            <button
              type="button" onClick={() => navigate('/account/phone', { state: { returnTo: pageAPath(origin) } })}
              className={`${btnPrimary} mt-5 h-12 w-full text-base ${pressCls}`}
            >
              綁定手機
            </button>
            <button type="button" onClick={() => leaveToA()} className={`${btnOutline} mt-2 h-11 w-full`}>先不要</button>
          </div>
        )}
      </section>
    </SubPage>
  );
}
