import { LoaderCircle } from 'lucide-react';
import Banner from '../import/Banner';
import { btnOutline, btnPrimary } from '../import/ui';

export type StatusPhase = 'working' | 'slow' | 'timeout';

/**
 * S-2 登入中。回到網站、路由還沒掛載之前就要顯示，所以不依賴 BuyerLayout，是獨立的整頁。
 * 8 秒換說明、20 秒視為失敗（這兩個門檻是設計稿提議的，規格沒有定）。
 * 減少動態時轉圈圈靜止，「登入中…」文字本身就足以表達狀態。
 */
export default function AuthStatusScreen({ phase, onRetry, onHome }: { phase: StatusPhase; onRetry: () => void; onHome: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-canvas px-6 text-center">
      <div className="flex items-center gap-1.5 text-brand">
        <span className="text-2xl leading-none" aria-hidden="true">🛍️</span>
        <span className="text-xl font-bold tracking-tight">好物集</span>
      </div>
      {phase === 'timeout' ? (
        <div className="mt-8 w-full max-w-sm text-left">
          <Banner kind="error" title="登入花了太久">網路可能不太穩。請再試一次。</Banner>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={onRetry} className={`${btnPrimary} h-12 w-full text-base`}>重新登入</button>
            <button type="button" onClick={onHome} className={`${btnOutline} h-12 w-full text-base`}>回首頁</button>
          </div>
        </div>
      ) : (
        <div role="status">
          <LoaderCircle size={32} className="mx-auto mt-10 text-muted motion-safe:animate-spin" aria-hidden="true" />
          <p className="mt-4 text-base font-medium">登入中…</p>
          <p className="mt-1 text-sm text-muted">{phase === 'slow' ? '網路比較慢，請再等一下。' : '正在確認你的帳號'}</p>
        </div>
      )}
    </div>
  );
}
