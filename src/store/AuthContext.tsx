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
import { browserStores, clearPending, peekPending, type PendingAction, type PendingInput } from '../lib/auth/pending';
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

interface PanelState { trigger: PendingInput | null; expired: boolean }

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
  /** Supabase 專案有啟用的登入提供者；沒啟用的按鈕不顯示。讀不到時兩顆都顯示 */
  providers: EnabledProviders;
}

const Ctx = createContext<AuthCtx | null>(null);

/** 待辦動作 → 登入面板用的輸入（拿掉回到哪一頁與建立時間） */
export function toInput(a: PendingAction): PendingInput {
  switch (a.kind) {
    case 'add_to_cart':
    case 'buy_now': return { kind: a.kind, productId: a.productId, variantId: a.variantId, qty: a.qty };
    case 'checkout': return { kind: 'checkout', items: a.items, fromCart: a.fromCart, payment: a.payment, address: a.address };
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
  const inApp = useMemo(() => detectInApp(navigator.userAgent), []);
  const [handoff, setHandoff] = useState<PendingAction | null>(boot.handoff);
  const clearHandoff = useCallback(() => setHandoff(null), []);
  const [providers, setProviders] = useState<EnabledProviders>(ALL_PROVIDERS);

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

  // 登入完成（例如另一個分頁登入）：面板不必再開著
  useEffect(() => { if (user) setPanel(null); }, [user]);

  const runPendingOnLoad = mayRunPending(boot.outcome);

  const value = useMemo<AuthCtx>(() => ({
    inApp, panel, openLogin, closeLogin, loginError, setLoginError, autoNotice, setAutoNotice, runPendingOnLoad,
    handoff, clearHandoff, providers,
  }), [inApp, panel, openLogin, closeLogin, loginError, autoNotice, runPendingOnLoad, handoff, clearHandoff, providers]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {panel && <AuthSheet trigger={panel.trigger} expired={panel.expired} error={loginError} inApp={inApp} providers={providers} onClose={closeLogin} />}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return c;
}
