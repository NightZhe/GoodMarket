import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import ChatIcon from './ChatIcon';
import { pillButton, pillButtonPrimary } from '../pillButton';
import type { ChatSide } from '../../lib/chat/types';
import type { ConversationPhase } from '../../lib/chat/useConversation';

/** 置中的狀態頁（列表與對話共用）：圖示＋文字＋按鈕 */
export function CenterState({ icon, title, body, role, children }: {
  icon: ReactNode; title: string; body?: string; role?: 'status' | 'alert'; children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="text-muted">{icon}</span>
      <p role={role} className="max-w-xs text-headline font-semibold text-ink">{title}</p>
      {body && <p className="max-w-xs text-subhead text-muted">{body}</p>}
      {children}
    </div>
  );
}

/** 訊息載入中：4 個靜態灰塊氣泡（左右交錯），不閃爍、載入完不跳版 */
export function MessagesSkeleton() {
  return (
    <div role="status" className="min-h-0 flex-1 overflow-hidden px-4 py-4">
      <span className="sr-only">載入中</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-10 w-3/5 rounded-story bg-canvas" />
        <div className="ml-auto h-10 w-1/2 rounded-story bg-canvas" />
        <div className="h-16 w-2/3 rounded-story bg-canvas" />
        <div className="ml-auto h-10 w-2/5 rounded-story bg-canvas" />
      </div>
    </div>
  );
}

/** 對話存在，但訊息讀不到：訊息區置中顯示，輸入列照常可用 */
export function MessagesFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="訊息載入失敗" role="alert">
      <button type="button" onClick={onRetry} className={pillButton}>重試</button>
    </CenterState>
  );
}

/** 對話開不起來時的整頁狀態（設計 4.6）。直接打網址的人或舊書籤才會看到「降級」 */
export function ConversationFailure({ phase, side, listTo, homeTo, ordersTo, onRetry, onLogin }: {
  phase: Exclude<ConversationPhase, 'loading' | 'ready'>; side: ChatSide; listTo: string; homeTo: string; ordersTo: string;
  onRetry: () => void; onLogin: () => void;
}) {
  switch (phase) {
    case 'unavailable':
      return (
        <CenterState icon={<ChatIcon size={40} />} title="聊聊暫時無法使用，請稍後再試" role="status">
          <Link to={listTo} className={pillButton}>回聊聊</Link>
        </CenterState>
      );
    case 'login':
      return (
        <CenterState icon={<ChatIcon size={40} />} title="登入後就能和店家聊聊">
          <button type="button" onClick={onLogin} className={pillButtonPrimary}>登入或註冊</button>
        </CenterState>
      );
    case 'noshop':
      return side === 'buyer' ? (
        <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="找不到這家商店" role="alert">
          <Link to={homeTo} className={pillButton}>回首頁</Link>
        </CenterState>
      ) : (
        <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="找不到這個對話" role="alert">
          <Link to={listTo} className={pillButton}>回聊聊</Link>
        </CenterState>
      );
    case 'noorder':
      return (
        <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="找不到這筆訂單" role="alert">
          <Link to={ordersTo} className={pillButton}>回訂單</Link>
        </CenterState>
      );
    case 'error':
      return (
        <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="無法開啟對話" body="請檢查網路後再試一次。" role="alert">
          <button type="button" onClick={onRetry} className={pillButton}>重試</button>
        </CenterState>
      );
  }
}
