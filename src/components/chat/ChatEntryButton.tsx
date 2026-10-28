import { useNavigate } from 'react-router-dom';
import ChatIcon from './ChatIcon';
import { pillPress } from '../pillButton';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { useChat } from '../../store/ChatContext';
import { useBlockedShops } from '../../lib/block/useBlockedShops';
import { chatEntryVisible } from '../../lib/chat/nav';

interface Props {
  shopId: string;
  shopName: string;
  /** 進對話的路徑（lib/chat/nav 的 newChatPath） */
  to: string;
  /** pill＝商品頁、店家頁的灰膠囊；outline＝訂單卡片上的「聯絡賣家」 */
  variant: 'pill' | 'outline';
  /** 訂單卡片上的「聯絡賣家」：已經買過的店，就算本機封鎖了也要能聯絡（本機封鎖只管不要再看到它的商品） */
  ignoreLocalBlock?: boolean;
  /** 朗讀名稱（沒給＝「聊聊，詢問『店名』」）。訂單卡片要帶訂單編號 */
  label?: string;
  text?: string;
}

/**
 * 聊聊入口鈕（商品頁、店家頁、訂單卡片）。這些情況不顯示：資料庫還沒升級或還沒確認可用（R-M24）、自己的店（R-M2）、
 * 本機封鎖的店（設計 Q3）。遊客按了先登入，登入回來自動進入對話（待送出卡片照帶，AC-M1）；取消登入面板就留在原頁。
 * 是 <button> 不是連結：不能套進商品頁賣家區塊那個整列連結裡（巢狀互動元素），也要先判斷登入
 */
export default function ChatEntryButton({ shopId, shopName, to, variant, ignoreLocalBlock = false, label, text = '聊聊' }: Props) {
  const { availability } = useChat();
  const { user, myShop, getShop } = useStore();
  const { openLogin } = useAuth();
  const blocked = useBlockedShops();
  const navigate = useNavigate();

  if (!chatEntryVisible({
    availability, ownShop: myShop?.id === shopId, locallyBlocked: !ignoreLocalBlock && blocked.isBlocked(shopId),
    ownerKnownMissing: getShop(shopId)?.ownerId === null,
  })) return null;

  const go = () => {
    if (user) navigate(to);
    else openLogin({ trigger: { kind: 'goto', to } });
  };

  const cls = variant === 'pill'
    ? `relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-canvas px-4 text-subhead font-semibold text-brand before:absolute before:inset-x-0 before:-inset-y-1 active:bg-press ${pillPress}`
    : 'mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-line px-3 text-sm transition-colors duration-200 active:bg-press active:duration-0';

  return (
    <button type="button" onClick={go} aria-label={label ?? `聊聊，詢問『${shopName}』`} className={cls}>
      <ChatIcon size={variant === 'pill' ? 18 : 16} />
      {text}
    </button>
  );
}
