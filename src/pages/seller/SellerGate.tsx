import { useEffect, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { LogOut, Loader2, Smartphone } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';
import CodeStep from '../../components/auth/CodeStep';
import PrivacyNote from '../../components/auth/PrivacyNote';
import ProviderLogin from '../../components/auth/ProviderLogin';
import { focusPageHeading } from '../../components/auth/focusPageHeading';
import { useLoginProvider } from '../../components/auth/useLoginProvider';
import { usePhoneStep } from '../../components/auth/usePhoneStep';
import { inAppLines, headingFor } from '../../lib/auth/headings';
import { isIOS } from '../../lib/auth/inapp';
import { phoneOf, signedInText } from '../../lib/auth/identity';
import { shopErrorText } from '../../lib/shopErrors';

const AVATARS = ['🏪', '🌸', '🐱', '🍰', '🎮', '👜', '🪴', '📚', '💎', '🧶'];
const CITIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '新竹市', '花蓮縣'];

/** 賣家中心的門口：先登入，再開店。兩關都過了才看得到後台。 */
export default function SellerGate() {
  const { user, authReady, myShop } = useStore();

  if (!authReady) return <Splash />;
  if (!user) return <Shell><AuthForm /></Shell>;
  if (!myShop) return <Shell><ShopForm /></Shell>;
  return <Outlet />;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand via-[#f46b35] to-[#ff9a5a] text-white">
      <Loader2 className="animate-spin" size={32} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-br from-brand via-[#f46b35] to-[#ff9a5a]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-white">
        <Link to="/" className="flex items-center gap-1.5 text-xl font-bold">
          🛍️ 好物集 <span className="text-base font-normal opacity-90">賣家中心</span>
        </Link>
        <Link to="/" className="text-sm opacity-90 hover:opacity-100">回到購物 →</Link>
      </header>
      <main className="mx-auto grid max-w-5xl items-start gap-6 px-4 pb-12 pt-4 md:grid-cols-[1fr_420px] md:pt-12">
        <div className="text-white">
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">開一家店，<br />只要 3 分鐘</h1>
          <ul className="mt-6 space-y-2 text-sm opacity-95 md:text-base">
            <li>✓ 0 元開店，免上架費</li>
            <li>✓ 上架的商品，全站買家都看得到</li>
            <li>✓ 訂單、出貨、營收一個後台看完</li>
          </ul>
        </div>
        {children}
      </main>
    </div>
  );
}

// 輸入框 16px：iPhone 聚焦時小於 16px 會放大頁面；邊用 border-muted，白底上對比 4.83:1
const inputClass = 'mt-1 w-full rounded-sm border px-3 py-2.5 text-base outline-none focus:border-ink';

/** 賣家中心的登入：Apple／Google／手機號碼。Email 登入與註冊整個拿掉（P2、P10、R-32） */
function AuthForm() {
  const { inApp, loginError, providers } = useAuth();
  const step = usePhoneStep('login');
  const cardRef = useRef<HTMLDivElement>(null);
  const ios = isIOS(navigator.userAgent);
  const inCode = step.flow !== null;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (!inCode) cardRef.current?.focus({ preventScroll: true });
  }, [inCode]);

  if (step.flow) {
    return (
      <div ref={cardRef} tabIndex={-1} className="rounded-lg bg-white p-4 shadow-xl outline-none md:p-6">
        {/* 整張卡換成 S-10：沒有關閉鈕、沒有 Apple／Google */}
        <CodeStep
          mode="login" flow={step.flow} trigger={{ kind: 'goto' }} inApp={inApp} titleId="seller-code-title"
          onBack={step.back} onExit={step.back} onFlowChange={step.enter} onVerified={focusPageHeading}
        />
      </div>
    );
  }

  const inAppText = inApp && providers.phone ? inAppLines(inApp, ios) : null;
  const inAppFallback = inApp && !providers.phone ? headingFor({ trigger: null, expired: false, inApp, ios, providers }) : null;
  const intro = <p className="text-xs text-muted">第一次登入後，接著填寫商店資料就能開店。</p>;

  return (
    <div ref={cardRef} tabIndex={-1} className="rounded-lg bg-white p-4 shadow-xl outline-none md:p-6">
      {inAppText && <div className="mb-4"><Banner kind="info" title={inAppText.lead.replace(/。$/, '')}>{inAppText.rest}</Banner></div>}
      {inAppFallback && <div className="mb-4"><Banner kind="info" title={inAppFallback.title}>{inAppFallback.description}</Banner></div>}
      <ProviderLogin
        trigger={{ kind: 'goto' }} inApp={inApp} error={loginError} providers={providers} summary={false}
        onCodeSent={step.enter} lastPhone={step.lastPhone} afterProviders={inApp ? undefined : intro}
      />
      {inApp && <div className="mt-3">{intro}</div>}
      <PrivacyNote className="mt-3" />
    </div>
  );
}

function ShopForm() {
  const { createShop, signOut, user } = useStore();
  const provider = useLoginProvider(user);
  const [form, setForm] = useState({ name: '', avatar: AVATARS[0], description: '', location: CITIES[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setError('商店名稱至少 2 個字');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createShop({
        ...form,
        name: form.name.trim(),
        description: form.description.trim() || '歡迎光臨！',
      });
    } catch (err) {
      setError(shopErrorText(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  };

  // R-31：用手機登入、還沒有店。所有手機帳號都顯示，不判斷是不是新帳號（猜錯的代價比多顯示一則提示高）
  const viaPhone = provider === 'phone';
  const canBind = user !== null && !phoneOf(user);

  return (
    <form onSubmit={submit} className="rounded-lg bg-white p-6 shadow-xl">
      <h2 ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">建立我的商店</h2>
      <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted">
        <span>{user ? signedInText(user, true, provider ?? undefined) : ''}</span>
        {!viaPhone && canBind && (
          <>
            <span aria-hidden="true">・</span>
            <Link to="/account/phone" className="inline-flex min-h-11 items-center gap-1 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <Smartphone size={14} aria-hidden="true" />綁定手機
            </Link>
          </>
        )}
        {!viaPhone && (
          <>
            <span aria-hidden="true">・</span>
            <button type="button" onClick={() => void signOut()} className="inline-flex min-h-11 items-center text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">換帳號</button>
          </>
        )}
      </p>
      {viaPhone && (
        <div className="mt-3">
          <Banner
            kind="info" role="none" title="已經開過店了？"
            actions={<button type="button" onClick={() => void signOut()} className={btnOutline}><LogOut size={16} aria-hidden="true" />換帳號</button>}
          >
            請先按「換帳號」，用原本的方式（Google 或 Apple）登入，再到帳號頁綁定這支手機。
          </Banner>
        </div>
      )}

      <label className="mt-4 block text-sm">
        商店名稱
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          maxLength={20} placeholder="例如：小花手作雜貨" className={`${inputClass} border-muted`} />
      </label>

      <div className="mt-3 text-sm">
        商店頭像
        <div className="mt-1 flex flex-wrap gap-1.5">
          {AVATARS.map(a => (
            <button type="button" key={a} onClick={() => setForm(f => ({ ...f, avatar: a }))} aria-label={`頭像 ${a}`}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${form.avatar === a ? 'bg-brand-soft ring-2 ring-brand' : 'bg-canvas'}`}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-sm">
        出貨地
        <select value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
          className={`${inputClass} border-muted bg-white`}>
          {CITIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        商店簡介
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={2} maxLength={80} placeholder="一句話介紹你的商店"
          className={`${inputClass} resize-none border-muted`} />
      </label>

      {error && <p className="mt-3 rounded-sm bg-error-bg px-3 py-2 text-sm text-error-text">{error}</p>}

      <button disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-brand text-white transition hover:bg-brand-dark disabled:bg-disabled">
        {busy && <Loader2 size={16} className="animate-spin" />}
        免費開店
      </button>
    </form>
  );
}
