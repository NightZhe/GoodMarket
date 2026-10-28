import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import Banner from '../import/Banner';
import CodeStep from '../auth/CodeStep';
import TurnstileSlot from '../auth/TurnstileSlot';
import { useTurnstile } from '../auth/useTurnstile';
import { useLoginProvider } from '../auth/useLoginProvider';
import { OUTLINE, PRIMARY } from '../auth/authUi';
import { isIOS } from '../../lib/auth/inapp';
import { rememberVia } from '../../lib/auth/loginVia';
import { maskTwPhone, normalizeTwPhone } from '../../lib/auth/phone';
import { sendLoginCode } from '../../lib/auth/phoneApi';
import { classifyPhoneError, phoneErrorView, type PhoneErrorView } from '../../lib/auth/phoneErrors';
import { clearFlow, flowStore, rememberSend, saveFlow, type PhoneFlow } from '../../lib/auth/phoneFlow';
import { useOnline } from '../../lib/useOnline';
import { STEP_UP_TEXT } from '../../lib/payment/bankAccount';

/**
 * 新增第二個銀行帳號、更換撥款帳號前的簡訊再驗證（契約 4）：寄驗證碼到「帳號自己的」門號（不可改號），
 * 用 signInWithOtp 的路徑，成功會換發 amr=otp 的 session，之後 10 分鐘內送出才算數。
 * 沿用手機登入的 Turnstile、錯誤文案、60 秒重寄與 S-10 輸入畫面（CodeStep stepUp）。
 */
export default function StepUpVerify({ national, notice, exitLabel = '取消', onVerified, onCancel }: {
  /** 帳號上綁定的門號，例 0912345678 */
  national: string;
  /** 例如伺服器說驗證過期時，頂端的說明 */
  notice?: string;
  /** 退出鈕文字 */
  exitLabel?: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const { user } = useStore();
  const provider = useLoginProvider(user);
  const ios = isIOS(navigator.userAgent);
  const online = useOnline();
  const ts = useTurnstile({ enabled: true });
  const [flow, setFlow] = useState<PhoneFlow | null>(null);
  const [error, setError] = useState<PhoneErrorView | null>(null);
  const [need, setNeed] = useState<string | null>(null);
  const [offlineHit, setOfflineHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const e164 = normalizeTwPhone(national);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (online) setOfflineHit(false); }, [online]);

  const cancel = () => { clearFlow(flowStore()); onCancel(); };

  const send = async () => {
    if (busyRef.current || !e164.ok) return;
    setError(null);
    setNeed(null);
    if (!online || navigator.onLine === false) { setOfflineHit(true); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      if (ts.status === 'loading') setWaiting(true);
      const t = await ts.requestToken();
      if (!alive.current) return;
      setWaiting(false);
      if (!t.ok) {
        if (t.reason === 'interaction') { setNeed('請先完成上方的安全驗證，再傳送驗證碼。'); ts.focus(); }
        return;
      }
      const res = await sendLoginCode(e164.e164, t.token);
      ts.consume();
      if (!alive.current) return;
      if (res.error) {
        const { kind } = classifyPhoneError(res.error, { now: Date.now(), lastSentAt: null, op: 'send' });
        setError(phoneErrorView(kind, { inApp: null, ios }));
        return;
      }
      const now = Date.now();
      rememberSend(e164.e164, now);
      const next: PhoneFlow = { phone: e164.e164, step: 'login', sentAt: now, savedAt: now };
      saveFlow(flowStore(), next);
      setFlow(next);
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(false); setWaiting(false); }
    }
  };

  if (!e164.ok) return null;

  if (flow) {
    return (
      <CodeStep
        mode="login" stepUp exitLabel={exitLabel} flow={flow} titleId={`${ids}-title`}
        onBack={cancel} onExit={cancel} onFlowChange={setFlow}
        onVerified={() => {
          // 驗證碼會換發新 session（amr 是 otp）：記下原本的登入方式，帳號頁才不會說成「使用手機登入中」
          if (user && provider) rememberVia(flowStore(), user.id, { provider, at: Date.now() });
          onVerified();
        }}
      />
    );
  }

  const masked = maskTwPhone(national);
  return (
    <div>
      <h2 data-phase-title="" tabIndex={-1} className="text-lg font-bold outline-none">先確認是你本人</h2>
      <p className="mt-1 text-sm leading-6">{STEP_UP_TEXT}</p>
      {notice && <div className="mt-3"><Banner kind="warning" role="status" title={notice} /></div>}
      {offlineHit && !online && (
        <div className="mt-3"><Banner kind="warning" role="status" title="目前沒有網路連線">連上網路後再按一次「傳送驗證碼」。</Banner></div>
      )}
      {error && <div className="mt-3"><Banner kind={error.kind} role="alert" title={error.title}>{error.body}</Banner></div>}
      <p className="mt-3 text-sm">
        會傳送驗證碼簡訊到{' '}
        <strong className="whitespace-nowrap font-bold tabular-nums" aria-label={`你帳號上綁定的手機，尾數 ${national.slice(7)}`}>{masked}</strong>
        ，驗證碼 5 分鐘內有效。
      </p>
      <TurnstileSlot ctl={ts} inApp={null} ios={ios} where="傳送按鈕上方" needMessage={need} needId={`${ids}-need`} />
      <button type="button" onClick={() => void send()} aria-disabled={busy || undefined} aria-busy={busy || undefined} className={`${PRIMARY} mt-4 h-12 w-full text-base`}>
        {busy && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
        {busy ? '傳送中…' : '傳送驗證碼'}
      </button>
      {waiting && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><ShieldCheck size={16} aria-hidden="true" />正在進行安全驗證，請稍候…</p>}
      <p role="status" className="sr-only">{busy ? '正在傳送驗證碼' : ''}</p>
      <button type="button" onClick={cancel} className={`${OUTLINE} mt-2 h-11 w-full`}>{exitLabel}</button>
    </div>
  );
}
