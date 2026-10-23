import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';

// 物流設定列表與兩個表單頁共用的小元件（設計 2.2、4.5、5.5）。

export const SETTINGS_READ_TIMEOUT_MS = 10_000;

/** 「誰看得到」說明框（AC-L3）：靜態文字，不加 role */
export function VisibilityNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-sm bg-subtle p-2.5 text-sm">
      <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRetry(); } finally { setBusy(false); }
  };
  return (
    <button type="button" className={btnOutline} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void run()}>
      {busy ? '重試中…' : '重試'}
    </button>
  );
}

/** 資料庫還沒升級（R-L17）：沒有任何可編輯的東西，其他頁完全不受影響 */
export function UnavailableBanner({ onRetry }: { onRetry: () => Promise<unknown> | void }) {
  return (
    <Banner kind="warning" role="status" title="物流設定暫時無法使用" actions={<RetryButton onRetry={onRetry} />}>
      請稍後再試。
    </Banner>
  );
}
