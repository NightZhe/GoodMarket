import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { isIOS, type InAppKind } from '../../lib/auth/inapp';
import type { PendingInput } from '../../lib/auth/pending';
import type { EnabledProviders } from '../../lib/auth/providers';
import PrivacyNote from './PrivacyNote';
import ProviderLogin, { headingFor, type LoginErrorKind } from './ProviderLogin';

const FOCUSABLE = 'a[href],button:not([aria-disabled="true"]),input,[tabindex]:not([tabindex="-1"])';

/**
 * C-4 登入面板外殼：手機是貼底抽屜（跟商品頁的規格抽屜同一套），桌機是置中對話框。
 * 關閉＝放棄待辦動作，原頁維持原樣；開啟時焦點落在標題、Tab 只在面板內循環、Esc 關閉、關閉後焦點還給觸發的按鈕。
 * 背景鎖捲動。減少動態時進場動畫由 index.css 的規則關掉。
 */
export default function AuthSheet({ trigger, expired, error, inApp, providers, onClose }: {
  trigger: PendingInput | null; expired: boolean; error: LoginErrorKind; inApp: InAppKind | null; providers: EnabledProviders; onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { title, description } = headingFor({ trigger, expired, inApp, ios: isIOS(navigator.userAgent), providers });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = before;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-4" onKeyDown={onKeyDown}>
      <div className="animate-fade absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-desc"
        className="animate-auth-panel pb-safe relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white md:max-w-md md:rounded-lg md:shadow-popover"
      >
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-2">
            <h2 id="auth-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 text-lg font-bold outline-none">{title}</h2>
            <button
              type="button" onClick={onClose} aria-label="關閉，不登入"
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <p id="auth-desc" className="mt-1 text-sm text-muted">{description}</p>
          <div className="mt-4"><ProviderLogin trigger={trigger} inApp={inApp} error={error} providers={providers} /></div>
          {!inApp && <PrivacyNote className="mt-3" />}
        </div>
      </div>
    </div>
  );
}
