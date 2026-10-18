import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, PenLine, ShoppingCart, UserRound } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { headingFor } from '../../lib/auth/headings';
import { isIOS } from '../../lib/auth/inapp';
import Banner from '../import/Banner';
import CodeStep from './CodeStep';
import { currentExternalUrl } from './InAppBrowserNotice';
import PrivacyNote from './PrivacyNote';
import ProviderLogin from './ProviderLogin';
import { focusPageHeading } from './focusPageHeading';
import { usePhoneStep } from './usePhoneStep';

export type GateKind = 'cart' | 'checkout' | 'orders' | 'review' | 'account';

const GATES: Record<GateKind, { icon: ReactNode; title: string; description: string }> = {
  cart: { icon: <ShoppingCart size={28} />, title: '登入後查看購物車', description: '購物車和訂單會跟著帳號走，換手機也看得到。' },
  checkout: { icon: <ShoppingCart size={28} />, title: '登入後結帳', description: '登入後就能填寫收件資料並下訂單。' },
  orders: { icon: <ClipboardList size={28} />, title: '登入後查看訂單', description: '你的訂單會跟著帳號走，換手機也看得到。' },
  review: { icon: <PenLine size={28} />, title: '登入後撰寫評價', description: '評價要用下單時的帳號來寫。' },
  account: { icon: <UserRound size={28} />, title: '登入後查看帳號', description: '登入後可以管理個人檔案與收件地址、查看登入方式或登出。' },
};

/**
 * C-5 路由層級的登入閘門：#/cart、#/orders、#/account 這類頁面，沒登入時頁面本身就是登入畫面（沒有彈窗）。
 * 登入完回到這一頁（待辦動作是「回到目前頁面」）。登入過期時多一則說明。
 * 手機登入的 S-10 整個取代卡片內容（圖示與大標題暫時拿掉，沒有關閉鈕、沒有「先逛逛」）；驗證成功後卡片換成頁面內容。
 */
export default function AuthGate({ kind, expired = false }: { kind: GateKind; expired?: boolean }) {
  const { inApp, loginError, providers } = useAuth();
  const g = GATES[kind];
  const ios = isIOS(navigator.userAgent);
  const inAppHeading = inApp ? headingFor({ trigger: null, expired: false, inApp, ios, providers }) : null;
  const step = usePhoneStep('login');
  const inCode = step.flow !== null;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (!inCode) titleRef.current?.focus();
  }, [inCode]);

  const exitToProviders = () => {
    if (inApp === 'line') window.location.href = currentExternalUrl(inApp, { kind: 'goto' });
    else step.back();
  };

  return (
    <div className="mx-auto max-w-md md:px-4 md:py-12">
      <div className="bg-white px-4 py-8 text-center md:rounded-md md:px-8 md:py-10">
        {step.flow ? (
          <div className="text-left">
            <CodeStep
              mode="login" flow={step.flow} trigger={{ kind: 'goto' }} inApp={inApp} titleId="gate-title" descId="gate-desc"
              onBack={step.back} onExit={exitToProviders} onFlowChange={step.enter} onVerified={focusPageHeading}
            />
          </div>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true">{g.icon}</div>
            <h1 ref={titleRef} tabIndex={-1} className="mt-4 text-xl font-bold outline-none">{inAppHeading?.title ?? g.title}</h1>
            <p className="mt-1 text-sm text-pretty text-muted">{inAppHeading?.description ?? g.description}</p>
            {expired && (
              <div className="mt-4 text-left">
                <Banner kind="info" role="status" title="登入已過期">請重新登入。</Banner>
              </div>
            )}
            <div className="mt-6 text-left">
              <ProviderLogin
                trigger={{ kind: 'goto' }} inApp={inApp} error={loginError} providers={providers} summary={false}
                onCodeSent={step.enter} lastPhone={step.lastPhone}
              />
            </div>
            <PrivacyNote className="mt-4 text-left" />
            <Link to="/" className="mt-2 inline-flex min-h-11 items-center px-2 text-sm text-ink underline underline-offset-2">先逛逛，晚點再登入</Link>
          </>
        )}
      </div>
    </div>
  );
}
