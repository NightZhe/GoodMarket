import type { ReactNode } from 'react';
import ChatIcon from '../../components/chat/ChatIcon';

/**
 * 賣家聊聊的版面框（設計 7.1，純版面）。split＝桌機雙欄（網頁 ≥ 768，lib/layout/splitLayout），其餘是手機的兩頁。
 * 手機：列表頁只有列表（白卡）；對話頁只有對話，整頁。桌機：一張白卡，左列表（20rem、自己捲）右對話，沒選對話時右邊是提示。
 * 3.5rem＝賣家頂欄，3rem＝main 上下內距（md:p-6）
 */
export default function SellerChatFrame({ split, onThread, list, thread }: { split: boolean; onThread: boolean; list: ReactNode; thread: ReactNode }) {
  if (!split) {
    return onThread ? <>{thread}</> : <div className="flex min-h-[55dvh] flex-col overflow-hidden rounded-lg bg-white">{list}</div>;
  }
  return (
    <div className="flex h-[calc(100dvh-3.5rem-3rem)] overflow-hidden rounded-lg bg-white">
      <section aria-label="對話列表" className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-line">{list}</section>
      <div className="h-full min-w-0 flex-1">
        {onThread ? thread : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted">
            <ChatIcon size={48} />
            <p className="text-subhead">選擇左側的對話開始回覆</p>
          </div>
        )}
      </div>
    </div>
  );
}
