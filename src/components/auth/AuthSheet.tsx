import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { headingFor } from '../../lib/auth/headings';
import { isIOS, type InAppKind } from '../../lib/auth/inapp';
import type { PendingInput } from '../../lib/auth/pending';
import type { EnabledProviders } from '../../lib/auth/providers';
import SheetShell from '../SheetShell';
import CodeStep from './CodeStep';
import { currentExternalUrl } from './InAppBrowserNotice';
import PrivacyNote from './PrivacyNote';
import ProviderLogin, { type LoginErrorKind } from './ProviderLogin';
import { usePhoneStep } from './usePhoneStep';

/**
 * C-4 登入面板外殼：手機是貼底抽屜（跟商品頁的規格抽屜同一套），桌機是置中對話框。
 * 關閉＝放棄待辦動作，原頁維持原樣；開啟時焦點落在標題、Tab 只在面板內循環、Esc 關閉、關閉後焦點還給觸發的按鈕。
 * 背景鎖捲動。外殼（遮罩、焦點陷阱、捲動鎖）在 SheetShell，與結帳的地址抽屜共用。
 * 手機登入有兩個畫面：主畫面（Apple／Google／手機號碼）與 S-10 輸入驗證碼；步驟畫面整個取代面板內容，瞬間切換、沒有動畫。
 * 關閉面板不清掉 S-10 的保存狀態（R-25）：同分頁下次打開直接回到那一步；但待辦動作會作廢（closeLogin）。
 */
export default function AuthSheet({ trigger, expired, error, inApp, providers, onClose }: {
  trigger: PendingInput | null; expired: boolean; error: LoginErrorKind; inApp: InAppKind | null; providers: EnabledProviders; onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ios = isIOS(navigator.userAgent);
  const { title, description } = headingFor({ trigger, expired, inApp, ios, providers });
  const step = usePhoneStep('login');
  const inCode = step.flow !== null;

  // 切回主畫面（改用其他號碼）：焦點到標題、捲回最上面。第一次載入不動（SheetShell 已經處理）
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    contentRef.current?.closest('[role=dialog]')?.scrollTo(0, 0);
    if (!inCode) titleRef.current?.focus();
  }, [inCode]);

  // 「改用 Apple／Google 登入」：LINE 在這裡登不了 Google，直接外開；其他情況回主畫面
  const exitToProviders = () => {
    if (inApp === 'line') window.location.href = currentExternalUrl(inApp, trigger);
    else step.back();
  };

  return (
    <SheetShell titleId="auth-title" descId="auth-desc" titleRef={titleRef} onClose={onClose}>
      <div ref={contentRef} className="p-4 md:p-6">
        {step.flow ? (
          <CodeStep
            mode="login" flow={step.flow} trigger={trigger} inApp={inApp} titleId="auth-title" descId="auth-desc"
            onBack={step.back} onClose={onClose} onExit={exitToProviders} onFlowChange={step.enter} onVerified={() => {}}
          />
        ) : (
          <>
            <div className="flex items-start gap-2">
              <h2 id="auth-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 text-lg font-bold outline-none">{title}</h2>
              <button
                type="button" onClick={onClose} aria-label="關閉，不登入"
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>
            <p id="auth-desc" className="mt-1 text-sm text-pretty text-muted">{description}</p>
            <div className="mt-4"><ProviderLogin trigger={trigger} inApp={inApp} error={error} providers={providers} onCodeSent={step.enter} lastPhone={step.lastPhone} /></div>
            {/* 內建瀏覽器裡也要顯示（修 C-8）：手機登入要收集手機號碼 */}
            <PrivacyNote className="mt-3" />
          </>
        )}
      </div>
    </SheetShell>
  );
}
