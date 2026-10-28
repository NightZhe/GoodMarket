import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { isIOS, type InAppKind } from '../../lib/auth/inapp';
import type { PendingInput } from '../../lib/auth/pending';
import { CODE_LENGTH, formatTwPhone, nationalFromAuthPhone, normalizeCode } from '../../lib/auth/phone';
import { sendBindCode, sendLoginCode, verifyBindCode, verifyLoginCode } from '../../lib/auth/phoneApi';
import { classifyPhoneError, phoneErrorView, type PhoneErrorView } from '../../lib/auth/phoneErrors';
import { clearFlow, flowStore, rememberSend, resendSecondsLeft, saveFlow, type PhoneFlow } from '../../lib/auth/phoneFlow';
import { useOnline } from '../../lib/useOnline';
import { useAuth } from '../../store/AuthContext';
import Banner from '../import/Banner';
import { FieldError, FOCUS_RING, HELP, INPUT, INPUT_ERR, LABEL, OUTLINE, PRIMARY } from './authUi';
import TurnstileSlot from './TurnstileSlot';
import { useTurnstile } from './useTurnstile';

const WINDOW_TEXT = '5 分鐘內有效';

/** 距離可以重新傳送還有幾秒。用保存的傳送時間算；iOS 背景分頁的計時器會被凍結，回到前景要立刻重算 */
function useResendSeconds(sentAt: number | null): number {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const left = resendSecondsLeft(sentAt, Date.now());
  const counting = left > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(bump, 1000);
    return () => clearInterval(t);
  }, [counting, sentAt]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') bump(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('pageshow', bump);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('pageshow', bump); };
  }, []);
  return left;
}

export interface CodeStepProps {
  mode: 'login' | 'bind';
  flow: PhoneFlow;
  trigger?: PendingInput | null;
  inApp?: InAppKind | null;
  titleId: string;
  descId?: string;
  /** 「改用其他號碼」／返回：回到輸入手機號碼，帶原號碼 */
  onBack: () => void;
  /** 面板的關閉鈕；閘門、賣家中心、綁定頁沒有 */
  onClose?: () => void;
  /** 登入版「改用 Apple／Google 登入」；綁定版「取消綁定」。不給就等於 onBack */
  onExit?: () => void;
  /** 驗證成功（已清掉保存的狀態） */
  onVerified: () => void;
  /** 重新傳送成功：新的傳送時間 */
  onFlowChange: (f: PhoneFlow) => void;
  /** 綁定頁的 h1 已經是「綁定手機」，卡片內標題只給讀屏 */
  titleSrOnly?: boolean;
  /**
   * 已登入帳號的再驗證（新增第二個銀行帳號、更換撥款帳號）：對帳號自己的門號用登入的路徑發驗證碼換發新 session，但不是登入——
   * 成功不跳「登入成功」、不執行待辦動作；不能改用其他號碼（那會登入或建立另一個帳號），退出一律是 exitLabel
   */
  stepUp?: boolean;
  /** stepUp 時退出鈕的文字（返回箭頭的讀屏名稱與下方退出列），預設「取消」 */
  exitLabel?: string;
}

/** S-10 輸入簡訊驗證碼：買家面板、閘門、賣家中心、綁定共用 */
export default function CodeStep({ mode, flow, trigger = null, inApp = null, titleId, descId, onBack, onClose, onExit, onVerified, onFlowChange, titleSrOnly = false, stepUp = false, exitLabel = '取消' }: CodeStepProps) {
  const ids = useId();
  const codeId = `${ids}-code`;
  const helpId = `${ids}-help`;
  const errId = `${ids}-err`;
  const needId = `${ids}-need`;
  const ios = isIOS(navigator.userAgent);
  const online = useOnline();
  const { completePhoneLogin } = useAuth();
  // 「我已經收到驗證碼」那條路不該去載入安全驗證（AC-10）：等到真的要重新傳送才開始
  const ts = useTurnstile({ enabled: mode === 'login', lazy: flow.sentAt === null });

  const [value, setValue] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [banner, setBanner] = useState<PhoneErrorView | null>(null);
  const [offlineHit, setOfflineHit] = useState<'確認' | '重新傳送驗證碼' | null>(null);
  const [needMessage, setNeedMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [waitingSecurity, setWaitingSecurity] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const left = useResendSeconds(flow.sentAt);

  const national = nationalFromAuthPhone(flow.phone) ?? '';
  const display = formatTwPhone(national);
  const lead = flow.sentAt === null;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // 進入 S-10：焦點到標題，不進驗證碼欄（iOS 程式聚焦多半叫不出鍵盤，而且讀屏要先聽到傳到哪支手機；design 5.3）
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => { if (online) setOfflineHit(null); }, [online]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setBanner(null);
    setNotice('');
    const r = normalizeCode(value);
    if (!r.ok) {
      setCodeError(r.reason === 'empty' ? '請輸入驗證碼' : `驗證碼是 ${CODE_LENGTH} 位數字`);
      inputRef.current?.focus();
      return;
    }
    setCodeError(null);
    if (!online || navigator.onLine === false) { setOfflineHit('確認'); return; }
    busy.current = true;
    setVerifying(true);
    const res = await (mode === 'login' ? verifyLoginCode(flow.phone, r.code) : verifyBindCode(flow.phone, r.code));
    busy.current = false;
    if (!res.error) {
      clearFlow(flowStore());
      // 不管面板還在不在：使用者已經是登入狀態，待辦動作要照常完成（R-8）
      if (mode === 'login' && !stepUp) completePhoneLogin(trigger);
      onVerified();
      return;
    }
    if (!alive.current) return;
    setVerifying(false);
    const { kind } = classifyPhoneError(res.error, { now: Date.now(), lastSentAt: flow.sentAt, op: 'verify' });
    const view = phoneErrorView(kind, { inApp, ios });
    if (kind === 'otp_invalid' || kind === 'code_empty') {
      // 錯、過期、被重傳取代分不出來，一律同一句；欄位清空、焦點回驗證碼欄
      setCodeError(view.title);
      setValue('');
      inputRef.current?.focus();
    } else {
      setBanner(view);
    }
  };

  const resend = async () => {
    if (busy.current || left > 0) return;
    setBanner(null);
    setNotice('');
    setNeedMessage(null);
    if (!online || navigator.onLine === false) { setOfflineHit('重新傳送驗證碼'); return; }
    busy.current = true;
    setResending(true);
    try {
      let token: string | undefined;
      if (mode === 'login') {
        if (ts.status === 'loading' || ts.status === 'off') setWaitingSecurity(ts.status === 'loading');
        const t = await ts.requestToken();
        if (!alive.current) return;
        setWaitingSecurity(false);
        if (!t.ok) {
          if (t.reason === 'interaction') { setNeedMessage('請先完成上方的安全驗證，再重新傳送。'); ts.focus(); }
          return;
        }
        token = t.token;
      }
      // 重新傳送＝再呼叫一次 /otp（登入）或 updateUser（綁定），不用 resend（t2 F-5）。舊的驗證碼立刻失效
      const res = mode === 'login' ? await sendLoginCode(flow.phone, token) : await sendBindCode(flow.phone);
      if (mode === 'login') ts.consume();
      if (!alive.current) return;
      if (res.error) {
        const { kind } = classifyPhoneError(res.error, { now: Date.now(), lastSentAt: flow.sentAt, op: 'send' });
        // captcha_failed 沒有寄出，不啟動倒數（只有成功才換新的傳送時間）
        setBanner(phoneErrorView(kind, { inApp, ios }));
        return;
      }
      const now = Date.now();
      rememberSend(flow.phone, now);
      const next: PhoneFlow = { ...flow, sentAt: now, savedAt: now };
      saveFlow(flowStore(), next);
      setValue('');
      setCodeError(null);
      setNotice('已重新傳送，之前的驗證碼已失效。');
      onFlowChange(next);
    } finally {
      busy.current = false;
      if (alive.current) { setResending(false); setWaitingSecurity(false); }
    }
  };

  const digits = value.length;
  const description = lead
    ? <>請輸入傳到 <PhoneText>{display}</PhoneText> 的 {CODE_LENGTH} 位數驗證碼。驗證碼有效 5 分鐘，過期請重新傳送。</>
    : <>驗證碼已傳送到 <PhoneText>{display}</PhoneText>，{WINDOW_TEXT}。</>;
  const srLead = lead ? `請輸入傳到 ${display} 的 ${CODE_LENGTH} 位數驗證碼` : `驗證碼已傳送到 ${display}`;
  const altExit = stepUp ? exitLabel : mode === 'bind' ? '取消綁定'
    : inApp ? `用${inApp === 'line' && ios ? ' Safari ' : '瀏覽器'}開啟後改用 Apple／Google 登入` : '改用 Apple／Google 登入';

  return (
    <div>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label={stepUp ? exitLabel : '改用其他號碼'} className={`-ml-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-ink ${FOCUS_RING}`}>
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} data-step-title="" className={`min-w-0 flex-1 pt-2 text-lg font-bold outline-none ${titleSrOnly ? 'sr-only' : ''}`}>
          輸入驗證碼<span className="sr-only">。{srLead}</span>
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="關閉，不登入" className={`-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted ${FOCUS_RING}`}>
            <X size={22} aria-hidden="true" />
          </button>
        )}
      </div>
      <p id={descId} className="mt-1 text-sm text-muted">{description}</p>

      {offlineHit && !online && (
        <div className="mt-4"><Banner kind="warning" role="status" title="目前沒有網路連線">連上網路後再按一次「{offlineHit}」。</Banner></div>
      )}
      {banner && (
        <div className="mt-4"><Banner kind={banner.kind} role="alert" title={banner.title}>{banner.body}</Banner></div>
      )}

      <form noValidate method="post" onSubmit={e => void verify(e)} className="mt-4">
        <label htmlFor={codeId} className={LABEL}>驗證碼</label>
        <input
          id={codeId} ref={inputRef} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" enterKeyHint="done"
          value={value} readOnly={verifying} aria-invalid={codeError ? true : undefined} aria-describedby={`${helpId}${codeError ? ` ${errId}` : ''}`}
          onChange={e => { setValue(e.target.value.normalize('NFKC').replace(/[\s\-]/g, '')); if (codeError) setCodeError(null); }}
          className={`${INPUT} mt-1 h-14 text-center text-xl font-medium tracking-[0.2em] tabular-nums ${codeError ? INPUT_ERR : ''}`}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p id={helpId} className={`${HELP} mt-0`}>{CODE_LENGTH} 位數字，可以直接貼上。</p>
          <span aria-hidden="true" className="shrink-0 text-sm tabular-nums text-muted">{digits}／{CODE_LENGTH}</span>
        </div>
        {codeError && <FieldError id={errId}>{codeError}</FieldError>}
        <button type="submit" aria-disabled={verifying || undefined} aria-busy={verifying || undefined} className={`${PRIMARY} mt-4 h-12 w-full text-base`}>
          {verifying && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
          {verifying ? '驗證中…' : mode === 'bind' ? '確認綁定' : '確認'}
        </button>
        <p role="status" className="sr-only">{verifying ? '正在驗證' : ''}</p>
      </form>

      <section aria-labelledby={`${ids}-help-title`} className="mt-6 border-t border-line pt-4">
        <h3 id={`${ids}-help-title`} className="text-sm font-medium">還是沒收到？</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted [overflow-wrap:anywhere]">
          {stepUp
            ? <li>驗證碼只會傳到你帳號上綁定的手機 {display}。</li>
            : <li>確認手機號碼是 {display}，打錯了請改用其他號碼。</li>}
          <li>簡訊可能要 1 分鐘才會收到。寄件者會是一串號碼，內容開頭是【好物集】。</li>
          <li>重新傳送後，之前的驗證碼會失效。</li>
        </ul>

        {mode === 'login' && <TurnstileSlot ctl={ts} inApp={inApp} ios={ios} where="重新傳送按鈕上方" needMessage={needMessage} needId={needId} />}
        <button
          type="button" onClick={() => void resend()} aria-disabled={left > 0 || resending || undefined} aria-busy={resending || undefined}
          aria-label="重新傳送驗證碼" className={`${OUTLINE} mt-3 h-11 w-full`}
        >
          {resending
            ? <><LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /><span aria-hidden="true">傳送中…</span></>
            : <span aria-hidden="true">{left > 0 ? `${left} 秒後可以重新傳送` : '重新傳送驗證碼'}</span>}
        </button>
        {waitingSecurity && <p className="mt-2 text-sm text-muted">正在進行安全驗證，請稍候…</p>}
        <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-success-text">
          {notice && <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}{notice}
        </p>

        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {!stepUp && <li><ExitRow onClick={onBack}>改用其他號碼</ExitRow></li>}
          <li><ExitRow onClick={onExit ?? onBack}>{altExit}</ExitRow></li>
        </ul>
      </section>
    </div>
  );
}

function PhoneText({ children }: { children: string }) {
  return <strong className="whitespace-nowrap font-bold tabular-nums text-ink">{children}</strong>;
}

function ExitRow({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${FOCUS_RING}`}>
      <span>{children}</span><ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  );
}
