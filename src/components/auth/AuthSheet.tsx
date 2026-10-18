import { useRef } from 'react';
import { X } from 'lucide-react';
import { isIOS, type InAppKind } from '../../lib/auth/inapp';
import type { PendingInput } from '../../lib/auth/pending';
import type { EnabledProviders } from '../../lib/auth/providers';
import SheetShell from '../SheetShell';
import PrivacyNote from './PrivacyNote';
import ProviderLogin, { headingFor, type LoginErrorKind } from './ProviderLogin';

/**
 * C-4 登入面板外殼：手機是貼底抽屜（跟商品頁的規格抽屜同一套），桌機是置中對話框。
 * 關閉＝放棄待辦動作，原頁維持原樣；開啟時焦點落在標題、Tab 只在面板內循環、Esc 關閉、關閉後焦點還給觸發的按鈕。
 * 背景鎖捲動。外殼（遮罩、焦點陷阱、捲動鎖）在 SheetShell，與結帳的地址抽屜共用。
 */
export default function AuthSheet({ trigger, expired, error, inApp, providers, onClose }: {
  trigger: PendingInput | null; expired: boolean; error: LoginErrorKind; inApp: InAppKind | null; providers: EnabledProviders; onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { title, description } = headingFor({ trigger, expired, inApp, ios: isIOS(navigator.userAgent), providers });

  return (
    <SheetShell titleId="auth-title" descId="auth-desc" titleRef={titleRef} onClose={onClose}>
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
    </SheetShell>
  );
}
