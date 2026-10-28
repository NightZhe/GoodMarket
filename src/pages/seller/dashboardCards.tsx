import { Link } from 'react-router-dom';
import { ChevronRight, Star } from 'lucide-react';
import ChatIcon from '../../components/chat/ChatIcon';
import { focusRing } from '../../components/import/ui';
import { SELLER_CHAT_LIST_PATH } from '../../lib/chat/sellerPaths';
import { unreadOverview } from '../../lib/chat/unread';

// 賣場總覽的兩個聊聊相關元件（設計 8.3）。188 寬（手機 200% 文字）時藏起裝飾圖示，文字才有空間（同 ReturnPrompt）。

/**
 * 「你有 N 則未讀訊息」提示卡。N＝店家側未讀訊息總數（chat_unread_summary 的 shop_messages，不是對話數）。
 * 0 則、載入中、讀取失敗、降級時摘要都是 0，一律不顯示。用品牌淡色而非警示色：有人找你是機會不是問題
 */
export function UnreadMessagesCard({ messages }: { messages: number }) {
  const text = unreadOverview(messages);
  if (!text) return null;
  return (
    <Link to={SELLER_CHAT_LIST_PATH} className={`mt-3 flex min-h-12 items-center gap-3 rounded-md border border-brand/25 bg-brand-soft p-3 text-sm ${focusRing}`}>
      <ChatIcon size={20} className="shrink-0 text-brand max-[239px]:hidden" />
      <span className="min-w-0 flex-1 font-medium text-ink">{text}</span>
      <ChevronRight size={18} className="shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
    </Link>
  );
}

/** 評價管理入口列（所有寬度都顯示，AC-M35）。評價管理退出底欄後，從總覽進 */
export function ReviewsEntryRow() {
  return (
    <Link to="/seller/reviews" className={`flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm ${focusRing}`}>
      <Star size={20} className="shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        評價管理
        <span className="block text-xs text-muted">查看與回覆買家的評價</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
    </Link>
  );
}
