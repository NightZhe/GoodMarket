import { useEffect, useMemo, useState } from 'react';
import { routeOfHash } from '../../lib/auth/callback';
import { APPLE_USABLE_IN_APP, type InAppKind } from '../../lib/auth/inapp';
import { startOAuth, type OAuthProvider } from '../../lib/auth/oauth';
import { browserStores, buildPending, canPersist, clearPending, savePending, type PendingInput } from '../../lib/auth/pending';
import { ALL_PROVIDERS, type EnabledProviders } from '../../lib/auth/providers';
import { useOnline } from '../../lib/useOnline';
import Banner from '../import/Banner';
import { AuthButtons, PROVIDER_ORDER } from './AuthButton';
import InAppBrowserNotice from './InAppBrowserNotice';
import PendingSummary from './PendingSummary';

export type LoginErrorKind = 'failed' | 'unavailable' | null;

/** 登入面板、登入閘門、賣家中心共用的標題與說明（S-1、S-3） */
export function headingFor(a: { trigger: PendingInput | null; expired: boolean; inApp: InAppKind | null; ios: boolean; providers?: EnabledProviders }) {
  if (a.inApp === 'line') {
    return { title: a.ios ? '請改用 Safari 登入' : '請改用瀏覽器登入', description: 'LINE 內建的瀏覽器無法使用 Google 登入。' };
  }
  if (a.inApp) return { title: '請改用瀏覽器開啟', description: 'Facebook、Instagram 內建的瀏覽器無法使用 Google 登入。' };
  // 說明文字跟著「實際顯示的按鈕」走：Apple 沒啟用時不能還寫「Google 或 Apple」
  const p = a.providers ?? ALL_PROVIDERS;
  const description = p.google && p.apple ? '用 Google 或 Apple 一鍵登入，不用設密碼。'
    : p.google ? '用 Google 一鍵登入，不用設密碼。'
    : p.apple ? '用 Apple 一鍵登入，不用設密碼。'
    : '登入功能暫時無法使用，請稍後再試。';
  if (a.expired) {
    // 只有結帳會還原收件資料、付款方式與商品；個人檔案、地址表單過期時只保留剛才填的內容
    const description = a.trigger?.kind === 'checkout'
      ? '請重新登入。你填的收件資料、付款方式和商品都還在。'
      : '請重新登入。你剛才填的內容都還在。';
    return { title: '登入已過期', description };
  }
  if (a.trigger?.kind === 'add_to_cart') return { title: '登入後才能加入購物車', description };
  if (a.trigger?.kind === 'buy_now') return { title: '登入後才能購買', description };
  return { title: '登入好物集', description };
}

/**
 * 按下 Google／Apple 之後：先把待辦動作存起來，再整頁跳過去。
 * 跳走的那一瞬間頁面還在，所以按鈕要先變成「前往…」；從 Google 頁面按「返回」時 iOS Safari 會從 bfcache
 * 還原整個頁面（含卡住的轉圈圈），要監聽 pageshow 重設，而且不顯示任何訊息（分辨不出是取消還是手勢返回）。
 */
export function useOAuthStarter(trigger: PendingInput | null) {
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [startError, setStartError] = useState<'offline' | 'unavailable' | null>(null);
  const online = useOnline();

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  useEffect(() => { if (online) setStartError(s => (s === 'offline' ? null : s)); }, [online]);

  const start = async (provider: OAuthProvider) => {
    if (busy) return;
    setStartError(null);
    if (!online || navigator.onLine === false) { setStartError('offline'); return; }
    setBusy(provider);
    // 沒有待辦動作的純登入也要寫（回到目前這一頁），並蓋掉上一次留下的舊動作：同一時間只保留最新一筆
    savePending(browserStores(), buildPending(trigger ?? { kind: 'goto' }, routeOfHash(window.location.hash), Date.now()));
    const r = await startOAuth(provider);
    if (!r.ok) {
      clearPending(browserStores());
      setBusy(null);
      setStartError(r.reason);
    }
  };
  return { busy, start, startError, online };
}

const DIVIDER = (
  <p className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
    <span className="h-px flex-1 bg-line" />或<span className="h-px flex-1 bg-line" />
  </p>
);

/**
 * 登入的主要內容：[橫幅] → [待辦摘要] → Google／Apple 按鈕，或內建瀏覽器說明。
 * summary=false 給賣家中心用（沒有待辦動作可以摘要）。
 */
export default function ProviderLogin({ trigger, inApp, error, providers, summary = true }: {
  trigger: PendingInput | null; inApp: InAppKind | null; error: LoginErrorKind; providers: EnabledProviders; summary?: boolean;
}) {
  const { busy, start, startError, online } = useOAuthStarter(trigger);
  const canSave = useMemo(() => canPersist(browserStores()), []);
  const autoTrigger = trigger && (trigger.kind === 'add_to_cart' || trigger.kind === 'buy_now' || trigger.kind === 'checkout');
  const storageBlocked = Boolean(autoTrigger) && !canSave;
  const err = startError === 'unavailable' ? 'unavailable' : error;
  const offline = !online || startError === 'offline';
  const showError = err !== null && !offline;

  const banners = (
    <>
      {offline && (
        <Banner kind="warning" role="status" title="目前沒有網路連線">連上網路後再按一次登入。</Banner>
      )}
      {showError && err === 'failed' && (
        <Banner kind="error" title="登入沒有完成">請在同一個瀏覽器再試一次。</Banner>
      )}
      {showError && err === 'unavailable' && (
        <Banner kind="error" title="暫時無法登入">請稍後再試。如果一直失敗，請改用另一種登入方式。</Banner>
      )}
      {storageBlocked && !inApp && (
        <Banner kind="info" title="這個瀏覽器無法暫存你的選擇">
          登入後請再按一次「{trigger?.kind === 'buy_now' ? '直接購買' : '加入購物車'}」。
        </Banner>
      )}
    </>
  );

  const appleUsable = inApp ? APPLE_USABLE_IN_APP[inApp] && providers.apple : false;
  // 沒啟用的提供者不顯示（按了會落在 Supabase 的英文錯誤頁）。兩顆都沒啟用時說明原因
  const shown = PROVIDER_ORDER.filter(p => providers[p]);

  if (inApp) {
    return (
      <div className="space-y-4">
        {banners}
        {appleUsable && (
          <>
            <Banner kind="info" title={inApp === 'line' ? 'LINE 裡無法使用 Google 登入' : '這裡無法使用 Google 登入'} />
            <AuthButtons busy={busy} onSelect={p => void start(p)} providers={['apple']} />
            {DIVIDER}
          </>
        )}
        <InAppBrowserNotice kind={inApp} trigger={trigger} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banners}
      {summary && !storageBlocked && <PendingSummary trigger={trigger} />}
      <div>
        {showError && <p className="mb-2 text-sm font-medium">重新登入</p>}
        {shown.length > 0
          ? <AuthButtons busy={busy} onSelect={p => void start(p)} providers={shown} />
          : <Banner kind="error" title="暫時無法登入">目前沒有可用的登入方式，請稍後再試。</Banner>}
      </div>
    </div>
  );
}
