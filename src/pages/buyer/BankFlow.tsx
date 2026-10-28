import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import LoginRequired from '../../components/auth/LoginRequired';
import RequirePayment from '../../components/payment/RequirePayment';
import { EMPTY_DRAFT, type BankAccountList, type BankDraft } from '../../lib/payment/bankAccount';
import { setBankDone, type BankDone } from '../../lib/payment/bankDone';
import { flowBase, pageAPath, type BankOrigin } from '../../lib/payment/bankRoutes';
import { useBankAccounts, type BankPhase } from '../../lib/payment/useBankAccounts';
import { useOnline } from '../../lib/useOnline';

export interface BankFlowCtx {
  origin: BankOrigin;
  base: string;
  online: boolean;
  /** 填到一半的表單。只在這個元件的記憶體：離開流程（元件卸載）就沒了，不進任何儲存空間（AC-7、AC-44） */
  draft: BankDraft;
  setDraft: (d: BankDraft | ((prev: BankDraft) => BankDraft)) => void;
  accounts: BankAccountList | null;
  phase: BankPhase;
  reload: (silent?: boolean) => Promise<boolean>;
  setList: (l: BankAccountList) => void;
  /** 回頁 A（可帶完成訊息）。從頁 A 一路走進來的就退回去，否則取代目前這頁 */
  leaveToA: (done?: BankDone) => void;
}

const Ctx = createContext<BankFlowCtx | null>(null);
export const useBankFlow = (): BankFlowCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useBankFlow: outside BankFlow');
  return c;
};

function wasReload(): boolean {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
}

/**
 * 新增銀行帳號流程的外框（選銀行、填資料、簡訊驗證）：登入閘門＋付款開關閘門＋共用的列表與表單草稿。
 * origin 決定完成後回哪個入口的頁 A
 */
export default function BankFlow({ origin }: { origin: BankOrigin }) {
  return (
    <LoginRequired kind="account">
      <RequirePayment to={origin === 'seller' ? '/seller' : '/account'}>
        <FlowView origin={origin} />
      </RequirePayment>
    </LoginRequired>
  );
}

function FlowView({ origin }: { origin: BankOrigin }) {
  const online = useOnline();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { fromA?: boolean } | null };
  const [draft, setDraft] = useState<BankDraft>(EMPTY_DRAFT);
  const { data, phase, reload, setList } = useBankAccounts({ timeoutMs: 10_000 });
  // 流程第一頁在歷史裡的位置（react-router 把 idx 放在 history.state）
  const startIdx = useRef<number>((window.history.state as { idx?: number } | null)?.idx ?? 0);
  // 重新整理後歷史位置不可靠（startIdx 變成目前這頁），不假設前面是頁 A
  const fromA = useRef(state?.fromA === true && !wasReload());

  const leaveToA = useCallback((done?: BankDone) => {
    if (done) setBankDone(done);
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    const steps = idx - startIdx.current + 1;
    if (fromA.current && steps > 0) navigate(-steps);
    else navigate(pageAPath(origin), { replace: true });
  }, [navigate, origin]);

  // 資料庫還沒升級：頁 A 會說明「暫時無法使用」，這裡不用做任何事
  if (phase === 'unavailable') return <Navigate to={pageAPath(origin)} replace />;

  const ctx: BankFlowCtx = { origin, base: flowBase(origin), online, draft, setDraft, accounts: data, phase, reload, setList, leaveToA };
  return <Ctx.Provider value={ctx}><Outlet /></Ctx.Provider>;
}
