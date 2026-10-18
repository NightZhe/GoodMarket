import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { routeOfHash } from '../../lib/auth/callback';
import { APPLE_USABLE_IN_APP, type InAppKind } from '../../lib/auth/inapp';
import type { PhoneFlow } from '../../lib/auth/phoneFlow';
import { startOAuth, type OAuthProvider } from '../../lib/auth/oauth';
import { browserStores, buildPending, canPersist, clearPending, savePending, type PendingInput } from '../../lib/auth/pending';
import type { EnabledProviders } from '../../lib/auth/providers';
import { useOnline } from '../../lib/useOnline';
import Banner from '../import/Banner';
import { AuthButtons, PROVIDER_ORDER } from './AuthButton';
import InAppBrowserNotice from './InAppBrowserNotice';
import PendingSummary from './PendingSummary';
import PhoneForm from './PhoneForm';

export type LoginErrorKind = 'failed' | 'unavailable' | null;

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

const Divider = ({ children = '或' }: { children?: string }) => (
  <p className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
    <span className="h-px flex-1 bg-line" />{children}<span className="h-px flex-1 bg-line" />
  </p>
);

/**
 * 登入的主要內容：[橫幅] → [待辦摘要] → Apple／Google 按鈕 →「或用手機號碼繼續」→ 手機表單；
 * 內建瀏覽器裡手機表單在最上面（P12），Google／Apple 退成「想用 Google 或 Apple 登入？」的外開退路。
 * summary=false 給閘門與賣家中心用（沒有待辦動作可以摘要）。
 * onCodeSent：手機號碼步驟傳送成功，外殼切到 S-10；lastPhone＝「改用其他號碼」回來時帶入的號碼。
 */
export default function ProviderLogin({ trigger, inApp, error, providers, summary = true, onCodeSent, lastPhone, afterProviders }: {
  trigger: PendingInput | null; inApp: InAppKind | null; error: LoginErrorKind; providers: EnabledProviders; summary?: boolean;
  onCodeSent: (flow: PhoneFlow) => void; lastPhone?: string;
  /** 放在 Google／Apple 按鈕與手機號碼之間的一句說明（賣家中心：第一次登入後接著填商店資料） */
  afterProviders?: ReactNode;
}) {
  const { busy, start, startError, online } = useOAuthStarter(trigger);
  const canSave = useMemo(() => canPersist(browserStores()), []);
  const autoTrigger = trigger && (trigger.kind === 'add_to_cart' || trigger.kind === 'buy_now' || trigger.kind === 'checkout');
  const storageBlocked = Boolean(autoTrigger) && !canSave;
  const err = startError === 'unavailable' ? 'unavailable' : error;
  const phoneShown = providers.phone;
  // 手機表單自己會在送出時說「目前沒有網路連線」；Google／Apple 按下去才發現離線時才用這則
  const offline = startError === 'offline' || (!online && !phoneShown);
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

  const phone = phoneShown && (
    <PhoneForm mode="login" trigger={trigger} inApp={inApp} externalBusy={busy !== null} initialPhone={lastPhone} onCodeSent={onCodeSent} />
  );
  const pending = summary && !storageBlocked && <PendingSummary trigger={trigger} compact={phoneShown} />;

  const appleUsable = inApp ? APPLE_USABLE_IN_APP[inApp] && providers.apple : false;
  // 沒啟用的提供者不顯示（按了會落在 Supabase 的英文錯誤頁）。全部都沒啟用時說明原因
  const shown = PROVIDER_ORDER.filter(p => providers[p]);

  if (inApp) {
    return (
      <div className="space-y-4">
        {banners}
        {pending}
        {appleUsable && (
          <>
            <AuthButtons busy={busy} onSelect={p => void start(p)} providers={['apple']} />
            <Divider>或用手機號碼繼續</Divider>
          </>
        )}
        {phone}
        {phoneShown && <Divider />}
        <InAppBrowserNotice kind={inApp} trigger={trigger} withPhone={phoneShown} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banners}
      {pending}
      {(shown.length > 0 || !phoneShown) && (
        <div>
          {showError && <p className="mb-2 text-sm font-medium">重新登入</p>}
          {shown.length > 0
            ? <AuthButtons busy={busy} onSelect={p => void start(p)} providers={shown} />
            : <Banner kind="error" title="暫時無法登入">目前沒有可用的登入方式，請稍後再試。</Banner>}
        </div>
      )}
      {afterProviders}
      {phoneShown && shown.length > 0 && <Divider>或用手機號碼繼續</Divider>}
      {phone}
    </div>
  );
}
