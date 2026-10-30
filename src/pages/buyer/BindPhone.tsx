import { useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import Banner from '../../components/import/Banner';
import { SubHeader, SubPage } from '../../components/account/ui';
import { phoneErrorView } from '../../lib/auth/phoneErrors';
import { useLoginProvider } from '../../components/auth/useLoginProvider';
import CodeStep from '../../components/auth/CodeStep';
import LoginRequired from '../../components/auth/LoginRequired';
import PhoneForm from '../../components/auth/PhoneForm';
import { usePhoneStep } from '../../components/auth/usePhoneStep';
import { phoneOf, providerLabel } from '../../lib/auth/identity';
import { maskTwPhone, nationalFromAuthPhone } from '../../lib/auth/phone';
import { rememberVia } from '../../lib/auth/loginVia';
import { clearFlow, flowStore } from '../../lib/auth/phoneFlow';
import { safeBankReturn } from '../../lib/payment/bankRoutes';

/**
 * S-9 綁定手機 #/account/phone：已登入、還沒有門號的帳號（買家、Google／Apple 賣家）加一支手機，
 * 之後可以用這支手機登入同一個帳號（P11）。獨立頁而不是彈窗：三個步驟、可以重新整理還原（R-25）、iOS 左滑返回有意義。
 * 不需要 Turnstile（/user 不檢查 captcha）；成功後回帳號頁，頂端橫幅說明，不執行待辦動作。
 */
export default function BindPhone() {
  return (
    <LoginRequired kind="account">
      <BindView />
    </LoginRequired>
  );
}

function BindView() {
  const { user } = useStore();
  const { providers } = useAuth();
  const navigate = useNavigate();
  // 從「銀行帳號」來的（新增第二個帳號、換撥款帳號前要先有手機）：綁完回那一頁，而不是帳號頁
  const returnTo = safeBankReturn((useLocation().state as { returnTo?: unknown } | null)?.returnTo);
  const home = returnTo ?? '/account';
  const provider = useLoginProvider(user);
  const step = usePhoneStep('bind');
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 只看「一進來」有沒有門號：綁定成功時 user 會先更新，不能因此被導走而丟掉成功橫幅
  const hadPhone = useRef(user !== null && phoneOf(user) !== null);
  const mounted = useRef(false);
  const inCode = step.flow !== null;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; if (!inCode) titleRef.current?.focus({ preventScroll: true }); return; }
    if (!inCode) titleRef.current?.focus({ preventScroll: true });
  }, [inCode]);

  if (hadPhone.current) return <Navigate to={home} replace />;

  const leave = () => { clearFlow(flowStore()); navigate(home); };

  return (
    <SubPage>
      <SubHeader
        to={home} onBack={() => clearFlow(flowStore())} titleRef={titleRef} title="綁定手機"
        backLabel={returnTo ? '回到銀行帳號' : '回到我的帳號'} backText={returnTo ? '返回' : undefined}
      />
      <section className="rounded-card bg-white p-4 md:p-6">
        {step.flow ? (
          <CodeStep
            mode="bind" flow={step.flow} titleId="bind-title" titleSrOnly
            onBack={step.back} onExit={leave} onFlowChange={step.enter}
            onVerified={() => {
              // 驗證碼會換發新 session（amr 是 otp），記下綁定前是用什麼登入，帳號頁才不會說成「使用手機登入中」
              if (user && provider) rememberVia(flowStore(), user.id, { provider, at: Date.now() });
              const n = nationalFromAuthPhone(step.flow?.phone);
              navigate(home, { replace: true, state: { bound: n ? maskTwPhone(n) : '' } });
            }}
          />
        ) : !providers.phone ? (
          // 手機登入被後台關掉：不讓人白填一次（R-13）
          <Banner kind="error" title={provider === 'google' || provider === 'apple'
            ? `目前暫停手機登入，你的帳號仍可以用 ${providerLabel(provider)} 登入。`
            : phoneErrorView('provider_disabled').title.replace('，請改用 Apple 或 Google。', '，請稍後再試。')} />
        ) : (
          <>
            <p className="text-sm text-muted">綁定後，你也可以用這支手機號碼登入同一個帳號，購物車和訂單都在。</p>
            <div className="mt-4">
              <PhoneForm mode="bind" initialPhone={step.lastPhone} onCodeSent={step.enter} />
            </div>
          </>
        )}
      </section>
    </SubPage>
  );
}
