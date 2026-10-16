import type { ReactNode } from 'react';
import { WifiOff } from 'lucide-react';
import { btnOutline } from '../import/ui';

/** 載入中的骨架：外層 aria-busy，讀屏唸「載入中」；Reduce Motion 時不脈動，只是靜態灰塊 */
export function ReviewSkeleton({ rows = 3, seller = false }: { rows?: number; seller?: boolean }) {
  return (
    <div aria-busy="true" className="divide-y divide-line">
      <p role="status" className="sr-only">載入中</p>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className={`flex gap-2 py-4 ${seller ? 'px-4 md:px-5' : ''}`}>
          <span className="h-7 w-7 shrink-0 rounded-full bg-line motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-24 rounded-sm bg-line motion-safe:animate-pulse" />
            <div className="h-3 w-full rounded-sm bg-line motion-safe:animate-pulse" />
            <div className="h-3 w-2/3 rounded-sm bg-line motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 區塊內的載入失敗：整頁還在，不搶畫面 */
export function InlineError({ title, onRetry, retrying }: { title: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <WifiOff size={32} className="text-muted" aria-hidden="true" />
      <p role="alert" className="text-sm">{title}</p>
      <button type="button" onClick={onRetry} aria-disabled={retrying || undefined} className={btnOutline}>重試</button>
    </div>
  );
}

export function EmptyBlock({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-5xl" aria-hidden="true">{icon}</div>
      <p className="text-base font-medium">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
