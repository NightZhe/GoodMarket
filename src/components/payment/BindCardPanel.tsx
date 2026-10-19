import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import Banner from '../import/Banner';
import { btnOutline, btnPrimary } from '../import/ui';
import { Bone, pressCls } from '../account/ui';
import { useOnline } from '../../lib/useOnline';
import { bindConfirm, bindStart, errorCodeOf, isAuthError } from '../../lib/payment/api';
import { BIND_SESSION_KEY, taiwanTimeMs } from '../../lib/payment/bind';
import { ecpayBindToken, ecpayStep, loadEcpaySdk, type EcpayGlobal } from '../../lib/payment/ecpaySdk';
import { PAYMENT_ERROR_TEXT, PaymentError } from '../../lib/payment/errors';
import type { BindStartResponse } from '../../lib/payment/types';

/** 取 Token、載入 SDK 與欄位逾時 10 秒當失敗（設計 7.3）；按下確認後 30 秒沒有結果當「結果不明」 */
const PREPARE_TIMEOUT_MS = 10_000;
const CONFIRM_TIMEOUT_MS = 30_000;
/** 自動跳轉 8 秒後仍在這頁，顯示手動繼續的連結（LINE 裡自動導轉可能失敗） */
const MANUAL_LINK_MS = 8_000;

type Phase =
  | 'preparing' | 'ready' | 'loadError' | 'idle' | 'badCard' | 'binding' | 'redirecting'
  | { kind: 'blocked'; code: 'CARD_LIMIT' | 'PAYMENT_DISABLED' };

export interface BindPanelProps {
  variant: 'page' | 'sheet';
  /** 3D 驗證後導回的站內路徑（不能含 ?，後端會接 ?bind=…&no=…） */
  returnPath: string;
  from: 'page' | 'checkout';
  /** 這次綁好了（不需要 3D）。duplicate＝這張卡之前綁過 */
  onBound: (info: { no: string; paymentMethodId: string; duplicate: boolean }) => void;
  /** 銀行未通過、結果不明：到結果頁用編號查伺服器 */
  onResult: (no: string, hint: 'failed' | 'confirming') => void;
  /** 要跳去 3D 之前（結帳要先把結帳快照存起來） */
  onBeforeRedirect?: () => void;
  onAuthLost: () => void;
  onCancel: () => void;
  /** 面板進入「不能再用」的狀態（滿 5 張、功能暫停）時通知頁面換整頁說明 */
  onBlocked?: (code: 'CARD_LIMIT' | 'PAYMENT_DISABLED') => void;
}

/**
 * 綠界綁卡面板（S-3 頁與 S-5 抽屜共用，只有這一份實作）。
 * 欄位是綠界 SDK 畫進 #ECPayPayment 的：卡號、有效期限、安全碼不經過我們的程式碼；我們只拿到 SDK 給的一次性代碼，交給自己的伺服器。
 */
export default function BindCardPanel({ variant, returnPath, from, onBound, onResult, onBeforeRedirect, onAuthLost, onCancel, onBlocked }: BindPanelProps) {
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [attempt, setAttempt] = useState(0);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  /** 載入失敗時伺服器給了明確原因（次數太多、綠界暫時不可用、帳號沒有聯絡方式）就說原因，否則用一般說明 */
  const [loadMsg, setLoadMsg] = useState('');
  const startRef = useRef<BindStartResponse | null>(null);
  const ecpayRef = useRef<EcpayGlobal | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onBlocked, onAuthLost });
  cbs.current = { onBlocked, onAuthLost };

  // 準備：取 Token → 載入 SDK → 畫欄位。attempt 變動＝重新來（Token 一次性，欄位要重畫）
  useEffect(() => {
    let alive = true;
    setPhase('preparing');
    setLoadMsg('');
    if (boxRef.current) boxRef.current.innerHTML = '';
    const timer = setTimeout(() => { if (alive) setPhase(p => (p === 'preparing' ? 'loadError' : p)); }, PREPARE_TIMEOUT_MS);
    void (async () => {
      try {
        const start = await bindStart(returnPath);
        if (!alive) return;
        const ecpay = await loadEcpaySdk(start.sdkUrl);
        if (!alive) return;
        await ecpayStep(cb => ecpay.initialize(ecpay.ServerType[start.serverType], 1, cb));
        if (!alive) return;
        await ecpayStep(cb => ecpay.addBindingCard(start.token, ecpay.Language.zhTW, cb));
        if (!alive) return;
        startRef.current = start;
        ecpayRef.current = ecpay;
        setPhase('ready');
      } catch (e) {
        if (!alive) return;
        const code = errorCodeOf(e);
        if (isAuthError(e)) { cbs.current.onAuthLost(); setPhase('idle'); return; }
        if (code === 'CARD_LIMIT' || code === 'PAYMENT_DISABLED') {
          setPhase({ kind: 'blocked', code });
          cbs.current.onBlocked?.(code);
          return;
        }
        setLoadMsg(code === 'BIND_RATE_LIMIT' || code === 'BIND_UNAVAILABLE' || code === 'NO_CONTACT' ? PAYMENT_ERROR_TEXT[code] : '');
        setPhase('loadError');
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { alive = false; clearTimeout(timer); };
  }, [returnPath, attempt]);

  // 跳轉 8 秒後仍在這頁：給手動連結
  useEffect(() => {
    if (phase !== 'redirecting') return;
    const t = setTimeout(() => setShowManual(true), MANUAL_LINK_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const confirm = useCallback(async () => {
    const start = startRef.current;
    const ecpay = ecpayRef.current;
    if (!start || !ecpay || phase !== 'ready' || !online) return;
    // Token 30 分鐘有效：按下時已過期就不用送，直接說欄位失效
    if (!(taiwanTimeMs(start.tokenExpiresAt) > Date.now())) { setPhase('idle'); return; }
    let token: string;
    try {
      token = await ecpayBindToken(ecpay);
    } catch {
      setPhase('badCard'); // 綠界欄位自己會標出哪裡不對；我們不顯示它的原始文字
      return;
    }
    setPhase('binding');
    const no = start.merchantTradeNo;
    // 記下來源：結果頁（3D 回來、或不需要 3D 直接到結果）才知道主按鈕要寫「回到結帳」還是「回到付款方式」
    try { sessionStorage.setItem(BIND_SESSION_KEY, JSON.stringify({ no, from })); } catch { /* 被擋也沒關係：預設當作從付款方式頁來 */ }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; onResult(no, 'confirming'); }, CONFIRM_TIMEOUT_MS);
    try {
      const res = await bindConfirm(no, token);
      if (timedOut) return;
      clearTimeout(timer);
      if (res.status === 'bound') onBound({ no, paymentMethodId: res.paymentMethodId, duplicate: res.duplicate });
      else if (res.status === 'confirming') onResult(no, 'confirming');
      else if (res.status === 'failed') onResult(no, 'failed');
      else {
        // 需要 3D：同一個視窗整頁跳轉（綠界文件禁止 iframe；LINE、Facebook 的 iOS 內建瀏覽器開新分頁會失敗）
        onBeforeRedirect?.();
        setRedirectUrl(res.url);
        setPhase('redirecting');
        window.location.assign(res.url);
      }
    } catch (e) {
      if (timedOut) return;
      clearTimeout(timer);
      if (isAuthError(e)) { onAuthLost(); setPhase('idle'); return; }
      const code = errorCodeOf(e);
      if (e instanceof PaymentError && e.kind === 'network') onResult(no, 'confirming'); // 請求有沒有到伺服器不知道：不重送，去查
      else if (code === 'BIND_NOT_FOUND') setPhase('idle');
      else onResult(no, 'confirming');
    }
  }, [phase, online, from, onBound, onResult, onBeforeRedirect, onAuthLost]);

  if (phase === 'redirecting') {
    return (
      <div role="status" className="py-12 text-center">
        <LoaderCircle size={32} className="mx-auto text-muted motion-safe:animate-spin" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-bold">正在前往發卡銀行驗證…</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted text-pretty">完成驗證後會自動回到好物集。請不要按返回，也不要關閉這一頁。</p>
        {showManual && redirectUrl && (
          <a href={redirectUrl} className="mt-4 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-2">沒有自動跳轉？點這裡繼續</a>
        )}
      </div>
    );
  }

  if (typeof phase === 'object') return null; // 整頁說明由頁面依 onBlocked 畫

  const preparing = phase === 'preparing';
  const binding = phase === 'binding';
  const canConfirm = phase === 'ready' && online;
  const reload = () => setAttempt(n => n + 1);

  return (
    <div>
      {!online && (
        <div className="mb-3"><Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能綁定。</Banner></div>
      )}
      {phase === 'loadError' && (
        <div className="mb-3">
          <Banner kind="error" title="卡片欄位載入失敗" actions={<button type="button" className={btnOutline} onClick={reload}>重新載入</button>}>
            {loadMsg || '可能是網路不穩，或瀏覽器擋住了綠界科技的元件。'}
          </Banner>
        </div>
      )}
      {phase === 'idle' && (
        <div className="mb-3">
          <Banner kind="warning" role="status" title="這個畫面閒置太久了" actions={<button type="button" className={btnOutline} onClick={reload}>重新載入</button>}>
            卡片欄位已經失效，你輸入的內容不會保留。請重新載入後再填一次。
          </Banner>
        </div>
      )}
      {phase === 'badCard' && (
        <div className="mb-3">
          <Banner kind="error" title="卡片資料有誤">請檢查卡號、有效期限和安全碼，再按一次「確認綁定」。</Banner>
        </div>
      )}
      {binding && <p role="status" className="mb-3 text-sm">正在向銀行確認，請不要關閉或重新整理這一頁。</p>}

      <div role="group" aria-label="卡片資料（綠界科技提供）" inert={binding} className={phase === 'loadError' || phase === 'idle' ? 'hidden' : variant === 'sheet' ? 'min-h-[14rem]' : 'min-h-[17rem]'} aria-busy={preparing || undefined}>
        <div id="ECPayPayment" ref={boxRef} />
        {preparing && (
          <div aria-hidden="true" className="space-y-3 pt-1">
            <Bone className="h-12 w-full" /><Bone className="h-12 w-full" /><Bone className="h-12 w-2/3" />
          </div>
        )}
        {preparing && <p role="status" className="sr-only">正在載入綠界科技的卡片欄位</p>}
      </div>

      <div className={variant === 'sheet' ? 'pb-safe sticky bottom-0 -mx-4 mt-4 border-t border-line bg-white px-4 pt-3 md:-mx-6 md:px-6' : 'mt-4'}>
        <button
          type="button" onClick={() => void confirm()} aria-disabled={!canConfirm || undefined} aria-busy={binding || preparing || undefined}
          className={`${canConfirm || binding ? btnPrimary : `${btnOutline} text-muted`} h-12 w-full text-base ${pressCls} ${binding ? 'cursor-wait' : ''}`}
        >
          {binding && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
          {binding ? '綁定中…' : preparing ? '準備中…' : variant === 'sheet' ? '綁定並使用這張卡' : '確認綁定'}
        </button>
        {variant === 'page' && (
          <button type="button" onClick={onCancel} aria-disabled={binding || undefined} className={`${btnOutline} mt-2 h-12 w-full text-base ${pressCls}`}>取消</button>
        )}
        <p className={`mt-3 text-sm text-muted ${variant === 'sheet' ? 'pb-3' : ''}`}>
          {variant === 'sheet'
            ? '這張卡會綁定到你的帳號，下次結帳可以直接選；也可以到「付款方式」刪除。'
            : '綁定後，這張卡會存在你的帳號，結帳時可以直接選；也可以隨時到「付款方式」刪除。'}
        </p>
      </div>
    </div>
  );
}
