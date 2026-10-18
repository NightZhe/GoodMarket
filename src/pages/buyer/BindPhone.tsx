import { useEffect, useRef } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useLoginProvider } from '../../components/auth/useLoginProvider';
import CodeStep from '../../components/auth/CodeStep';
import LoginRequired from '../../components/auth/LoginRequired';
import PhoneForm from '../../components/auth/PhoneForm';
import { usePhoneStep } from '../../components/auth/usePhoneStep';
import { phoneOf } from '../../lib/auth/identity';
import { maskTwPhone, nationalFromAuthPhone } from '../../lib/auth/phone';
import { rememberVia } from '../../lib/auth/loginVia';
import { clearFlow, flowStore } from '../../lib/auth/phoneFlow';

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
  const navigate = useNavigate();
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

  if (hadPhone.current) return <Navigate to="/account" replace />;

  const leave = () => { clearFlow(flowStore()); navigate('/account'); };

  return (
    <div className="mx-auto max-w-2xl md:px-4 md:pt-6">
      <header className="flex items-center gap-1 px-2 py-1 md:px-0">
        <Link to="/account" onClick={() => clearFlow(flowStore())} aria-label="返回帳號" className="flex h-11 w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand">
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        <h1 ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">綁定手機</h1>
      </header>
      <section className="bg-white p-4 md:rounded-md md:p-6">
        {step.flow ? (
          <CodeStep
            mode="bind" flow={step.flow} titleId="bind-title" titleSrOnly
            onBack={step.back} onExit={leave} onFlowChange={step.enter}
            onVerified={() => {
              // 驗證碼會換發新 session（amr 是 otp），記下綁定前是用什麼登入，帳號頁才不會說成「使用手機登入中」
              if (user && provider) rememberVia(flowStore(), user.id, { provider, at: Date.now() });
              const n = nationalFromAuthPhone(step.flow?.phone);
              navigate('/account', { replace: true, state: { bound: n ? maskTwPhone(n) : '' } });
            }}
          />
        ) : (
          <>
            <p className="text-sm text-muted">綁定後，你也可以用這支手機號碼登入同一個帳號，購物車和訂單都在。</p>
            <div className="mt-4">
              <PhoneForm mode="bind" initialPhone={step.lastPhone} onCodeSent={step.enter} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
