import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBoot } from '../components/auth/AuthBoot';
import AuthSheet from '../components/auth/AuthSheet';
import { useToast } from '../components/Toast';
import type { AutoDetail, AutoMode, AutoReason } from '../lib/auth/autoAction';
import { routeOfHash } from '../lib/auth/callback';
import { handoffWhenLoggedOut, mayRunPending } from '../lib/auth/handoff';
import { ALL_PROVIDERS, fetchProviderSettings, type EnabledProviders } from '../lib/auth/providers';
import { supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import { detectInApp, type InAppKind } from '../lib/auth/inapp';
import { isNative } from '../lib/native/platform';
import { NATIVE_AUTH_EVENT, NATIVE_BACK_EVENT, takeNativeAuthOutcome, type NativeAuthOutcome } from '../lib/native/callback';
import { browserStores, clearPending, peekPending, type PendingAction, type PendingInput } from '../lib/auth/pending';
import { clearVia } from '../lib/auth/loginVia';
import { flowStore, isGateRoute, loadFlow } from '../lib/auth/phoneFlow';
import { useStore } from './StoreContext';

// 登入的畫面狀態：登入面板（手機抽屜、桌機對話框）、登入錯誤、回到商品頁後自動動作沒完成的說明。
// 要不要登入、登入後做什麼由各頁決定；這裡只管「面板開關」與「登入回來之後的結果怎麼讓畫面知道」。

export type LoginError = 'failed' | 'unavailable' | null;

export interface AutoNotice {
  mode: AutoMode;
  productId: string;
  reason: AutoReason;
  detail: AutoDetail;
  /** 只有「動作本身失敗」可以重試 */
  retry?: () => void;
}

/** remount＝換一個 key 讓登入面板重新掛載（App 內登入取消或失敗後，按鈕的「前往…」狀態才會重設） */
interface PanelState { trigger: PendingInput | null; expired: boolean; remount?: number }

interface AuthCtx {
  inApp: InAppKind | null;
  panel: PanelState | null;
  /** 開登入面板。trigger＝登入後要自動完成的動作（沒有就只是登入）；expired＝結帳時登入過期 */
  openLogin: (opts?: { trigger?: PendingInput; expired?: boolean }) => void;
  /** 關閉＝放棄待辦動作，原頁什麼都沒發生 */
  closeLogin: () => void;
  loginError: LoginError;
  setLoginError: (e: LoginError) => void;
  autoNotice: AutoNotice | null;
  setAutoNotice: (n: AutoNotice | null) => void;
  /** 這次載入是剛登入回來：PendingRunner 才可以取用「這個瀏覽器自己存下的」待辦動作 */
  runPendingOnLoad: boolean;
  /**
   * 網址參數帶來的動作（LINE 外開接續）。只能預填：沒登入開登入面板，已登入要使用者按一次確認，絕不自動執行（B-2）。
   * 離開那一頁、確認或不用了之後就清掉
   */
  handoff: PendingAction | null;
  clearHandoff: () => void;
  /** Supabase 專案有啟用的登入提供者；沒啟用的按鈕不顯示。讀不到時全部顯示 */
  providers: EnabledProviders;
  /**
   * 手機驗證成功（使用者按了「確認」且 verifyOtp 成功）。簡訊登入不會整頁轉址，runPendingOnLoad 永遠是 false，
   * 所以靠這個計數叫 PendingRunner 同頁執行待辦動作（R-8）。沒有要自動完成的動作時顯示 toast「登入成功」
   */
  completePhoneLogin: (trigger: PendingInput | null) => void;
  /** 這次載入內手機登入成功的次數；每一次是一個新的待辦動作執行 key */
  phoneLoginTick: number;
  /** 一開站就有一段沒完成的手機登入（R-25）：商品頁要還原登入前選的規格與數量 */
  flowRestored: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

/** 待辦動作 → 登入面板用的輸入（拿掉回到哪一頁與建立時間） */
export function toInput(a: PendingAction): PendingInput {
  switch (a.kind) {
    case 'add_to_cart':
    case 'buy_now': return { kind: a.kind, productId: a.productId, variantId: a.variantId, qty: a.qty };
    case 'checkout': return { kind: 'checkout', items: a.items, fromCart: a.fromCart, payment: a.payment, cardId: a.cardId, address: a.address };
    case 'goto': return { kind: 'goto' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const boot = useBoot();
  const toast = useToast();
  const { user, authReady } = useStore();
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [loginError, setLoginError] = useState<LoginError>(null);
  const [autoNotice, setAutoNotice] = useState<AutoNotice | null>(null);
  // App 殼不是 LINE／FB／IG 的內建瀏覽器：原生平台一律不套用內建瀏覽器的退路畫面
  const inApp = useMemo(() => (isNative() ? null : detectInApp(navigator.userAgent)), []);
  const [handoff, setHandoff] = useState<PendingAction | null>(boot.handoff);
  const clearHandoff = useCallback(() => setHandoff(null), []);
  const [providers, setProviders] = useState<EnabledProviders>(ALL_PROVIDERS);
  const [phoneLoginTick, setPhoneLoginTick] = useState(0);
  const [flowRestored] = useState(() => loadFlow(flowStore(), Date.now())?.step === 'login');

  // 啟動時讀一次哪些提供者有啟用（沒啟用的按鈕按了會落在英文錯誤頁）
  useEffect(() => {
    let alive = true;
    void fetchProviderSettings(supabaseUrl, supabaseAnonKey).then(p => { if (alive) setProviders(p); });
    return () => { alive = false; };
  }, []);

  const openLogin = useCallback((opts?: { trigger?: PendingInput; expired?: boolean }) => {
    setLoginError(null);
    setPanel({ trigger: opts?.trigger ?? null, expired: opts?.expired ?? false });
  }, []);

  const closeLogin = useCallback(() => {
    clearPending(browserStores());
    setPanel(null);
    setLoginError(null);
  }, []);

  // 登入回來的結果（只處理一次）：取消＝輕輕說一聲；失敗＝回到原頁重開面板（賣家中心用自己頁面上的橫幅）
  const handledBoot = useRef(false);
  useEffect(() => {
    if (handledBoot.current) return;
    handledBoot.current = true;
    if (boot.outcome === 'cancelled') {
      toast('登入已取消', 'info');
    } else if (boot.outcome === 'failed') {
      setLoginError('failed');
      const rec = peekPending(browserStores(), Date.now());
      const seller = routeOfHash(window.location.hash).startsWith('/seller');
      if (!seller) setPanel({ trigger: rec && !rec.expired ? toInput(rec.action) : null, expired: false });
    }
  }, [boot.outcome, toast]);

  // LINE 外開接續：在 Safari 開同一頁。還沒登入就直接進登入步驟（摘要顯示帶來的選擇，使用者按登入鈕才存起待辦動作）；
  // 已登入的人不會自動執行任何事，商品頁會問「要加入購物車嗎？」（見 ProductDetail）
  const handledHandoff = useRef(false);
  useEffect(() => {
    if (handledHandoff.current || !boot.handoff || !authReady) return;
    handledHandoff.current = true;
    if (user) return;
    const d = handoffWhenLoggedOut(boot.handoff, Date.now());
    setPanel({ trigger: d === 'login_panel' ? toInput(boot.handoff) : null, expired: false });
  }, [boot.handoff, authReady, user]);

  // R-25：重新整理或從簡訊 App 切回來頁面被重新載入，S-10 做到一半就回到 S-10（驗證碼欄空白）。
  // 閘門與賣家中心頁面本身就是登入畫面，自己會還原；其他頁面這裡把面板開回來，登入前選的規格與待辦動作跟著回來
  const handledFlow = useRef(false);
  useEffect(() => {
    if (handledFlow.current || !authReady) return;
    handledFlow.current = true;
    if (user || !flowRestored) return;
    if (isGateRoute(routeOfHash(window.location.hash))) return;
    const rec = peekPending(browserStores(), Date.now());
    setPanel(p => p ?? { trigger: rec && !rec.expired ? toInput(rec.action) : null, expired: false });
  }, [authReady, user, flowRestored]);

  // 登出之後，「綁定前是用什麼登入」的紀錄就沒有用了
  useEffect(() => { if (authReady && !user) clearVia(flowStore()); }, [authReady, user]);

  // 登入完成（例如另一個分頁登入）：面板不必再開著
  useEffect(() => { if (user) setPanel(null); }, [user]);

  const completePhoneLogin = useCallback((trigger: PendingInput | null) => {
    setPhoneLoginTick(n => n + 1);
    // 加入購物車由 PendingRunner 顯示「登入成功，已加入購物車」；直接購買進結帳頁、結帳過期有自己的橫幅，都不另外跳 toast
    if (!trigger || trigger.kind === 'goto') toast('登入成功');
  }, [toast]);

  // App 內的 Google／Apple 登入在同一頁完成（lib/native/auth.ts）：成功走手機登入同一條路執行待辦動作；
  // 取消與失敗的處理對齊整頁跳轉回來的版本（上面的 boot.outcome），並重新掛載面板讓按鈕狀態重設。
  // 冷啟動（App 被殺掉後由回跳網址叫醒）時結果可能在這裡掛載前就送出：掛載時先到信箱補收一次
  const handleNativeOutcome = useCallback((outcome: NativeAuthOutcome) => {
    const rec = peekPending(browserStores(), Date.now());
    const trigger = rec && !rec.expired ? toInput(rec.action) : null;
    if (outcome === 'signed_in') {
      completePhoneLogin(trigger);
    } else if (outcome === 'cancelled') {
      clearPending(browserStores());
      setPanel(p => (p ? { ...p, remount: Date.now() } : p));
      toast('登入已取消', 'info');
    } else {
      setLoginError('failed');
      const seller = routeOfHash(window.location.hash).startsWith('/seller');
      if (!seller) setPanel({ trigger, expired: false, remount: Date.now() });
    }
  }, [completePhoneLogin, toast]);
  useEffect(() => {
    if (!isNative()) return;
    const onNative = (e: Event) => {
      takeNativeAuthOutcome();
      handleNativeOutcome((e as CustomEvent<NativeAuthOutcome>).detail);
    };
    window.addEventListener(NATIVE_AUTH_EVENT, onNative);
    const boxed = takeNativeAuthOutcome();
    if (boxed) handleNativeOutcome(boxed);
    return () => window.removeEventListener(NATIVE_AUTH_EVENT, onNative);
  }, [handleNativeOutcome]);

  // Android 實體返回鍵：登入面板開著就只關面板（等同按 X），不回上一頁
  useEffect(() => {
    if (!isNative() || !panel) return;
    const onBack = (e: Event) => { e.preventDefault(); closeLogin(); };
    window.addEventListener(NATIVE_BACK_EVENT, onBack);
    return () => window.removeEventListener(NATIVE_BACK_EVENT, onBack);
  }, [panel, closeLogin]);

  const runPendingOnLoad = mayRunPending(boot.outcome);

  const value = useMemo<AuthCtx>(() => ({
    inApp, panel, openLogin, closeLogin, loginError, setLoginError, autoNotice, setAutoNotice, runPendingOnLoad,
    handoff, clearHandoff, providers, completePhoneLogin, phoneLoginTick, flowRestored,
  }), [inApp, panel, openLogin, closeLogin, loginError, autoNotice, runPendingOnLoad, handoff, clearHandoff, providers, completePhoneLogin, phoneLoginTick, flowRestored]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {panel && <AuthSheet key={panel.remount ?? 0} trigger={panel.trigger} expired={panel.expired} error={loginError} inApp={inApp} providers={providers} onClose={closeLogin} />}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return c;
}
