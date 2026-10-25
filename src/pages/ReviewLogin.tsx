import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { useAuth } from '../store/AuthContext';
import { useToast } from '../components/Toast';
import Banner from '../components/import/Banner';
import { btnOutline, btnPrimary } from '../components/import/ui';
import { Bone, Spinner, bigBtn, fieldCls, labelCls, savingBtn } from '../components/account/ui';
import Identity from '../components/account/Identity';
import TurnstileSlot from '../components/auth/TurnstileSlot';
import { useTurnstile } from '../components/auth/useTurnstile';
import { detectInApp, isIOS } from '../lib/auth/inapp';
import { CONTACT_EMAIL } from '../lib/site';
import { useOnline } from '../lib/useOnline';
import { classifyReviewLoginError, reviewLoginErrorText, type ReviewLoginErrorKind } from '../lib/reviewLogin/errors';
import { signInWithEmail } from '../lib/reviewLogin/signIn';
import { validateReviewLogin, type EmailCheck, type PasswordCheck } from '../lib/reviewLogin/validate';

/**
 * 審查登入 #/review-login（D-10）。只給 App 審查員：路由在 BuyerLayout 外，不在任何畫面露出連結。
 * 中英並列，英文片段一律 lang="en"（讀屏才會用英文念）。登入成功後的全站狀態由既有的 onAuthStateChange 接手。
 */

/** seq 讓同一種錯誤連續發生兩次時，焦點仍會再移到錯誤區一次 */
type Failure = { kind: ReviewLoginErrorKind | 'offline'; seq: number };

const MAIL_LINK = 'inline-flex min-h-11 items-center px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const En = ({ children }: { children: ReactNode }) => <span lang="en">{children}</span>;

/** 欄位下的錯誤句（中英並列）。account/ui 的 FieldError 只收純字串，放不下 lang="en" */
function FieldMsg({ id, zh, en }: { id: string; zh: string; en: string }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 text-sm text-error-text">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{zh}<En>{en}</En></span>
    </p>
  );
}

function Title() {
  return (
    <h1 id="rv-title" tabIndex={-1} className="text-title2 font-bold text-ink outline-none">
      審查登入 <span lang="en" className="block text-subhead font-normal text-muted">App Review Sign-in</span>
    </h1>
  );
}

export default function ReviewLogin() {
  const ids = useId();
  const emailId = `${ids}-email`;
  const passId = `${ids}-pass`;
  const emailErrId = `${ids}-email-err`;
  const passErrId = `${ids}-pass-err`;
  const needId = `${ids}-need`;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { user, authReady, signOutBuyer } = useStore();
  const { providers } = useAuth();
  const ts = useTurnstile({ enabled: true });
  const inApp = detectInApp(navigator.userAgent);
  const ios = isIOS(navigator.userAgent);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErr, setFieldErr] = useState<{ email: EmailCheck; password: PasswordCheck }>({ email: 'ok', password: 'ok' });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [needMessage, setNeedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingSecurity, setWaitingSecurity] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [focusTitle, setFocusTitle] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (failure) errRef.current?.focus(); }, [failure]);
  // 登出後表單才會重新出現：等它渲染完再把焦點交給標題
  useEffect(() => {
    if (focusTitle && !user) { document.getElementById('rv-title')?.focus(); setFocusTitle(false); }
  }, [focusTitle, user]);

  const fail = (kind: Failure['kind']) => setFailure({ kind, seq: ++seq.current });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setFailure(null);
    setNeedMessage(null);

    const v = validateReviewLogin(email, password);
    if (!v.ok) {
      setFieldErr({ email: v.email, password: v.password });
      (v.first === 'email' ? emailRef : passRef).current?.focus();
      return;
    }
    setFieldErr({ email: 'ok', password: 'ok' });
    if (!online || navigator.onLine === false) { fail('offline'); return; }

    busyRef.current = true;
    setBusy(true);
    let signedIn = false;
    try {
      if (ts.status === 'loading') setWaitingSecurity(true);
      const t = await ts.requestToken();
      if (!alive.current) return;
      setWaitingSecurity(false);
      if (!t.ok) {
        // failed／unavailable：TurnstileSlot 自己會顯示橫幅與重試；interaction：請審查員先勾選，焦點移到容器
        if (t.reason === 'interaction') {
          setNeedMessage('請先完成上方的安全驗證，再登入。 Please complete the security check above.');
          ts.focus();
        }
        return;
      }
      const res = await signInWithEmail(v.email, v.password, t.token);
      ts.consume();
      if (!alive.current) return;
      if (res.error) {
        setPassword('');
        fail(classifyReviewLoginError(res.error));
        return;
      }
      signedIn = true;
      // busy 保持為 true 到頁面離開：onAuthStateChange 可能比這行先更新 user，避免閃出「已登入」畫面
      navigate('/seller');
    } finally {
      busyRef.current = false;
      if (alive.current && !signedIn) { setBusy(false); setWaitingSecurity(false); }
    }
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutBuyer();
      setPassword('');
      setFocusTitle(true);
    } catch {
      toast('登出失敗，請檢查網路後再試 Sign-out failed.', 'error');
    } finally {
      if (alive.current) setSigningOut(false);
    }
  };

  const intro = (
    <p className="mt-2 text-subhead text-muted">此頁僅供 App 審查使用。<En>This page is for App Review only.</En></p>
  );
  const mailLink = <a href={`mailto:${CONTACT_EMAIL}`} className={MAIL_LINK}>{CONTACT_EMAIL}</a>;

  let body: ReactNode;
  if (!authReady) {
    body = (
      <>
        <Title />
        <div aria-busy="true" className="mt-6 space-y-3">
          <p role="status" className="sr-only">載入中 <En>Loading</En></p>
          <Bone className="h-12 w-full" />
          <Bone className="h-12 w-full" />
        </div>
      </>
    );
  } else if (user && !busy) {
    body = (
      <>
        <Title />
        {intro}
        <p className="mt-6 text-footnote font-semibold text-muted">目前已登入 <En>Signed in</En></p>
        <section className="mt-1.5 rounded-card bg-canvas p-4"><Identity user={user} /></section>
        <Link to="/seller" className={`${btnPrimary} ${bigBtn} mt-6`}>前往賣家中心 <En>Go to Seller Center</En></Link>
        <button
          type="button" onClick={() => void signOut()} aria-disabled={signingOut || undefined} aria-busy={signingOut || undefined}
          className={`${btnOutline} ${bigBtn} mt-3`}
        >
          {signingOut ? <><Spinner />登出中… <En>Signing out…</En></> : <>登出 <En>Sign out</En></>}
        </button>
      </>
    );
  } else if (!providers.email) {
    body = (
      <>
        <Title />
        {intro}
        <div className="mt-6">
          <Banner kind="warning" role="status" title="這個登入方式目前已關閉。">
            <p lang="en">Email sign-in is currently disabled.</p>
            <p className="mt-1">聯絡信箱 <En>Contact</En>：{mailLink}</p>
          </Banner>
        </div>
      </>
    );
  } else {
    const text = failure ? reviewLoginErrorText(failure.kind) : null;
    const emailBad = fieldErr.email === 'invalid';
    const passBad = fieldErr.password === 'empty';
    body = (
      <>
        <Title />
        {intro}
        <form noValidate onSubmit={e => void submit(e)} className="mt-6">
          <label htmlFor={emailId} className={labelCls}>電子郵件 <En>Email</En></label>
          <input
            id={emailId} ref={emailRef} type="email" inputMode="email" autoComplete="username" autoCapitalize="off" autoCorrect="off"
            spellCheck={false} enterKeyHint="next" value={email} readOnly={busy}
            aria-invalid={emailBad || undefined} aria-describedby={emailBad ? emailErrId : undefined}
            onChange={ev => { setEmail(ev.target.value); setFailure(null); if (emailBad) setFieldErr(f => ({ ...f, email: 'ok' })); }}
            className={`${fieldCls(emailBad)} mt-1`}
          />
          {emailBad && <FieldMsg id={emailErrId} zh="請輸入正確的 Email。" en="Enter a valid email address." />}

          <label htmlFor={passId} className={`${labelCls} mt-4`}>密碼 <En>Password</En></label>
          <input
            id={passId} ref={passRef} type="password" autoComplete="current-password" enterKeyHint="go" value={password} readOnly={busy}
            aria-invalid={passBad || undefined} aria-describedby={passBad ? passErrId : undefined}
            onChange={ev => { setPassword(ev.target.value); setFailure(null); if (passBad) setFieldErr(f => ({ ...f, password: 'ok' })); }}
            className={`${fieldCls(passBad)} mt-1`}
          />
          {passBad && <FieldMsg id={passErrId} zh="請輸入密碼。" en="Enter your password." />}

          <TurnstileSlot ctl={ts} inApp={inApp} ios={ios} where="登入按鈕上方" needMessage={needMessage} needId={needId} />

          {text && failure && (
            <div ref={errRef} tabIndex={-1} className="mt-4 outline-none">
              {failure.kind === 'offline'
                ? <Banner kind="warning" role="alert" title={text.zh}><En>{text.en}</En></Banner>
                : <Banner kind="error" title={text.zh}><En>{text.en}</En></Banner>}
            </div>
          )}

          <button
            type="submit" aria-disabled={busy || undefined} aria-busy={busy || undefined}
            className={`${busy ? savingBtn : btnPrimary} ${bigBtn} mt-4`}
          >
            {busy ? <><Spinner />登入中… <En>Signing in…</En></> : <>登入 <En>Sign in</En></>}
          </button>
          {waitingSecurity && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><ShieldCheck size={16} aria-hidden="true" />正在進行安全驗證，請稍候…</p>
          )}
          <p role="status" className="sr-only">
            {busy ? (waitingSecurity ? '正在進行安全驗證，請稍候' : <>正在登入 <En>Signing in</En></>) : ''}
          </p>
        </form>
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b-[0.5px] border-separator pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-11 max-w-md items-center px-5">
          <Link to="/" aria-label="好物集，回首頁" className="flex h-11 items-center text-headline font-bold">好物集</Link>
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">{body}</main>
    </div>
  );
}
