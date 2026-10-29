import { Link } from 'react-router-dom';
import ChatIcon from '../../components/chat/ChatIcon';
import { sellerNewChatPath } from '../../lib/chat/sellerPaths';

/**
 * 賣家訂單卡的「聯絡買家」：進該訂單買家的對話，訂單卡待送出（賣家唯一的發起入口，§6.4）。
 * 是連結不是按鈕：賣家一定已登入（在賣家中心裡）。樣式同買家訂單卡的「聯絡賣家」（ChatEntryButton outline）。
 * 降級（聊聊不可用）時呼叫端不要畫它
 */
export default function ContactBuyerLink({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  return (
    <Link
      to={sellerNewChatPath(orderId)}
      aria-label={`聯絡買家，訂單 ${orderNo}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-line px-3 text-sm transition-colors duration-200 hover:bg-canvas active:bg-press active:duration-0"
    >
      <ChatIcon size={16} />
      聯絡買家
    </Link>
  );
}
