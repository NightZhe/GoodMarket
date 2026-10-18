import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { routeOfHash } from '../../lib/auth/callback';
import { isIOS, type InAppKind } from '../../lib/auth/inapp';
import { browserStores, buildPending, savePending, type PendingInput } from '../../lib/auth/pending';
import { formatTwPhone, normalizeTwPhone, nationalFromAuthPhone } from '../../lib/auth/phone';
import { sendBindCode, sendLoginCode } from '../../lib/auth/phoneApi';
import { classifyPhoneError, phoneErrorView, type PhoneErrorKind, type PhoneErrorView } from '../../lib/auth/phoneErrors';
import { flowStore, lastSendAt, loadFlow, rememberSend, saveFlow, type PhoneFlow } from '../../lib/auth/phoneFlow';
import { useOnline } from '../../lib/useOnline';
import Banner from '../import/Banner';
import { CONTACT_EMAIL } from '../../lib/site';
import { FieldError, HELP, INPUT, INPUT_ERR, LABEL, LINK, OUTLINE, PRIMARY } from './authUi';
import TurnstileSlot from './TurnstileSlot';
import { useTurnstile } from './useTurnstile';

const FIELD_ERRORS = {
  empty: '請輸入手機號碼',
  format: '請輸入 09 開頭的 10 位數手機號碼',
  foreign: '請輸入 09 開頭的 10 位數手機號碼。目前只支援台灣手機號碼。',
} as const;

export interface PhoneFormProps {
  /** login＝註冊與登入同一條路（要過 Turnstile）；bind＝帳號頁綁定手機（updateUser，不需要 Turnstile） */
  mode: 'login' | 'bind';
  /** 登入後要自動完成的動作；會在傳送成功時存起來（bind 不需要） */
  trigger?: PendingInput | null;
  inApp?: InAppKind | null;
  /** Apple／Google 正在前往：手機表單也停用，避免兩條登入同時進行 */
  externalBusy?: boolean;
  /** 「改用其他號碼」回來時帶入的號碼（E.164） */
  initialPhone?: string;
  onCodeSent: (flow: PhoneFlow) => void;
}

/**
 * C-1 PhoneForm：手機號碼欄位＋[Turnstile]＋「傳送驗證碼」＋「我已經收到驗證碼」。買家面板、閘門、賣家中心、綁定頁共用。
 * 「傳送驗證碼」永遠可按：沒填好就在欄位下方講清楚、焦點移到欄位；唯一例外是安全驗證載入不了（aria-disabled＋原因）。
 */
export default function PhoneForm({ mode, trigger = null, inApp = null, externalBusy = false, initialPhone, onCodeSent }: PhoneFormProps) {
  const ids = useId();
  const inputId = `${ids}-phone`;
  const hintId = `${ids}-hint`;
  const errId = `${ids}-err`;
  const reasonId = `${ids}-reason`;
  const needId = `${ids}-need`;
  const ios = isIOS(navigator.userAgent);
  const online = useOnline();
  const ts = useTurnstile({ enabled: mode === 'login' });

  const [value, setValue] = useState(() => {
    const n = nationalFromAuthPhone(initialPhone);
    return n ? formatTwPhone(n) : '';
  });
  const [fieldError, setFieldError] = useState<keyof typeof FIELD_ERRORS | null>(null);
  const [serverError, setServerError] = useState<{ kind: PhoneErrorKind; view: PhoneErrorView } | null>(null);
  const [needMessage, setNeedMessage] = useState<string | null>(null);
  const [offlineHit, setOfflineHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitingSecurity, setWaitingSecurity] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (online) setOfflineHit(false); }, [online]);

  const inactive = busy || externalBusy;
  const securityBlocked = mode === 'login' && ts.status === 'unavailable';

  const tidy = () => {
    const r = normalizeTwPhone(value);
    if (r.ok) setValue(formatTwPhone(r.national));
  };

  const validate = () => {
    const r = normalizeTwPhone(value);
    if (!r.ok) {
      setFieldError(r.reason);
      inputRef.current?.focus();
      return null;
    }
    setFieldError(null);
    setValue(formatTwPhone(r.national));
    return r;
  };

  const saveTrigger = () => {
    // 沒有待辦動作的純登入也要寫（回到目前這一頁），並蓋掉上一次留下的舊動作：同一時間只保留最新一筆
    savePending(browserStores(), buildPending(trigger ?? { kind: 'goto' }, routeOfHash(window.location.hash), Date.now()));
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busyRef.current || externalBusy) return;
    setServerError(null);
    setNeedMessage(null);
    const phone = validate();
    if (!phone) return;
    if (securityBlocked) return;
    if (!online || navigator.onLine === false) { setOfflineHit(true); return; }

    busyRef.current = true;
    setBusy(true);
    try {
      let token: string | undefined;
      if (mode === 'login') {
        if (ts.status === 'loading') setWaitingSecurity(true);
        const t = await ts.requestToken();
        if (!alive.current) return;
        setWaitingSecurity(false);
        if (!t.ok) {
          // failed／unavailable：slot 自己會顯示橫幅與重試；interaction：請使用者先勾選，焦點移到容器
          if (t.reason === 'interaction') { setNeedMessage('請先完成上方的安全驗證，再傳送驗證碼。'); ts.focus(); }
          return;
        }
        token = t.token;
      }
      const res = mode === 'login' ? await sendLoginCode(phone.e164, token) : await sendBindCode(phone.e164);
      if (mode === 'login') ts.consume();
      if (!alive.current) return;
      if (res.error) {
        const { kind } = classifyPhoneError(res.error, { now: Date.now(), lastSentAt: lastSendAt(phone.e164, loadFlow(flowStore(), Date.now())), op: 'send' });
        setServerError({ kind, view: phoneErrorView(kind, { inApp, ios }) });
        return;
      }
      const now = Date.now();
      rememberSend(phone.e164, now);
      const flow: PhoneFlow = { phone: phone.e164, step: mode, sentAt: now, savedAt: now };
      if (mode === 'login') saveTrigger();
      saveFlow(flowStore(), flow);
      onCodeSent(flow);
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(false); setWaitingSecurity(false); }
    }
  };

  /** 「我已經收到驗證碼」：不傳送、不需要 Turnstile，直接進 S-10 */
  const alreadyHaveCode = () => {
    if (busyRef.current || externalBusy) return;
    setServerError(null);
    setNeedMessage(null);
    const phone = validate();
    if (!phone) return;
    const now = Date.now();
    const flow: PhoneFlow = { phone: phone.e164, step: 'login', sentAt: null, savedAt: now };
    saveTrigger();
    saveFlow(flowStore(), flow);
    onCodeSent(flow);
  };

  const describedBy = [hintId, fieldError ? errId : null].filter(Boolean).join(' ');
  const showOffline = offlineHit && !online;

  return (
    <form id={`${ids}-form`} noValidate method="post" onSubmit={e => void submit(e)}>
      {showOffline && (
        <div className="mb-4">
          <Banner kind="warning" role="status" title="目前沒有網路連線">連上網路後再按一次「傳送驗證碼」。</Banner>
        </div>
      )}
      {serverError && (
        <div className="mb-4">
          <Banner
            kind={serverError.view.kind} role="alert" title={serverError.view.title}
            actions={serverError.kind === 'phone_exists'
              ? <a href={`mailto:${CONTACT_EMAIL}`} className={OUTLINE}>來信請我們協助</a>
              : undefined}
          >
            {serverError.view.body}
          </Banner>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={inputId} className={LABEL}>手機號碼</label>
          <span id={hintId} className="text-sm text-muted">只限台灣手機號碼</span>
        </div>
        <div className="mt-1">
          <input
            id={inputId} ref={inputRef} type="tel" inputMode="numeric" autoComplete="tel" enterKeyHint="send" placeholder="0912-345-678"
            value={value} readOnly={inactive} aria-invalid={fieldError ? true : undefined} aria-describedby={describedBy}
            onChange={e => { setValue(e.target.value); if (fieldError) setFieldError(null); }}
            onBlur={tidy}
            onPaste={e => {
              const r = normalizeTwPhone(e.clipboardData.getData('text'));
              if (r.ok) { e.preventDefault(); setValue(formatTwPhone(r.national)); setFieldError(null); }
            }}
            // 數字鍵盤沒有 Return 鍵、SE 開鍵盤後按鈕可能被蓋住：欄位一聚焦就把送出鈕捲進可視範圍（瞬間，不用 smooth）
            onFocus={() => submitRef.current?.scrollIntoView({ block: 'nearest' })}
            className={`${INPUT} ${fieldError ? INPUT_ERR : ''}`}
          />
        </div>
        {fieldError ? <FieldError id={errId}>{FIELD_ERRORS[fieldError]}</FieldError> : null}
      </div>

      {mode === 'login' && <TurnstileSlot ctl={ts} inApp={inApp} ios={ios} where="手機號碼欄位下方" needMessage={needMessage} needId={needId} />}

      <button
        ref={submitRef} type="submit" aria-disabled={inactive || securityBlocked || undefined} aria-busy={busy || undefined}
        aria-describedby={securityBlocked ? reasonId : undefined}
        className={`${PRIMARY} mt-4 h-12 w-full text-base ${securityBlocked ? 'opacity-50' : ''}`}
      >
        {busy && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
        {busy ? '傳送中…' : '傳送驗證碼'}
      </button>
      {securityBlocked && <p id={reasonId} className={HELP}>安全驗證載入後才能傳送。</p>}
      {waitingSecurity && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><ShieldCheck size={16} aria-hidden="true" />正在進行安全驗證，請稍候…</p>
      )}
      <p role="status" className="sr-only">{busy ? (waitingSecurity ? '正在進行安全驗證，請稍候' : '正在傳送驗證碼') : ''}</p>

      {mode === 'login' && (
        <div className="mt-1 text-center">
          <button type="button" onClick={alreadyHaveCode} aria-disabled={inactive || undefined} className={LINK}>我已經收到驗證碼</button>
        </div>
      )}
    </form>
  );
}
