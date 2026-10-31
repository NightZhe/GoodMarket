import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import ChatListView from '../../components/chat/ChatListView';
import ConversationView from '../../components/chat/ConversationView';
import SellerChatFrame from './SellerChatFrame';
import { isChatThreadPath } from './sellerNav';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { cardTargetGone } from '../../lib/chat/cards';
import { orderDeepLink } from '../../lib/orders/deeplink';
import { SELLER_CHAT_LIST_PATH, parseSellerNewChat, sellerConversationPath } from '../../lib/chat/sellerPaths';
import { useChatList } from '../../lib/chat/useChatList';
import { useSplitLayout } from '../../lib/layout/splitLayout';
import { useOnline } from '../../lib/useOnline';
import type { OpenTarget } from '../../lib/chat/outbox';
import type { ChatCard } from '../../lib/chat/types';

/**
 * 賣家中心的聊聊（#/seller/chat…）。這一層是版面路由：手機只出列表或只出對話，桌機（≥768）左列表右對話。
 * 列表的資料放在這一層，所以桌機切換對話、手機從對話返回時列表都不重讀成「載入中」。
 * 賣家沒有隱藏對話（§8.5）：列表不給長按，對話選單只有封鎖
 */
export default function SellerChatShell() {
  const { pathname } = useLocation();
  const split = useSplitLayout();
  const onThread = isChatThreadPath(pathname);
  const openId = useMatch(`${SELLER_CHAT_LIST_PATH}/:conversationId`)?.params.conversationId;
  const selectedId = openId && openId !== 'new' ? openId : null;
  return <SellerChatFrame split={split} onThread={onThread} list={<ListPane selectedId={selectedId} focusHeading={!onThread} />} thread={<Outlet />} />;
}

function ListPane({ selectedId, focusHeading }: { selectedId: string | null; focusHeading: boolean }) {
  const list = useChatList('shop');
  const { openLogin } = useAuth();
  const online = useOnline();
  const heading = useRef<HTMLHeadingElement>(null);
  // 掛載時把焦點給頁標，讀屏從這頁的開頭念起（同 SellerReviews）；直接打開某個對話時不搶焦點
  const focusOnMount = useRef(focusHeading);
  useEffect(() => { if (focusOnMount.current) heading.current?.focus(); }, []);

  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="shrink-0 px-5 pb-2 pt-4 text-xl font-bold outline-none">聊聊</h1>
      {!online && <p role="status" className="shrink-0 bg-canvas px-5 py-1.5 text-xs text-muted">目前離線，顯示的是上次載入的內容</p>}
      <ChatListView
        m={{
          side: 'shop', phase: list.phase, rows: list.rows, hasMore: list.hasMore, loadingMore: list.loadingMore,
          moreFailed: list.moreFailed, staleFailed: list.staleFailed, now: new Date(), selectedId,
          rowTo: r => sellerConversationPath(r.conversation_id),
        }}
        h={{ onRetry: list.retry, onLoadMore: () => { void list.loadMore(); }, onLogin: () => openLogin({ trigger: { kind: 'goto' } }) }}
      />
    </>
  );
}

/** #/seller/chat/:conversationId：既有對話。換對話用 key 讓整個畫面重來（輸入框的草稿不帶到別人那裡） */
export function SellerChatThread() {
  const id = useMatch(`${SELLER_CHAT_LIST_PATH}/:conversationId`)?.params.conversationId ?? '';
  return <SellerConversation key={id} target={{ kind: 'conversation', id }} />;
}

/** #/seller/chat/new?order=…：從訂單卡「聯絡買家」進，對話還不一定存在（訂單卡待送出，沒有對話時不可移除） */
export function SellerChatNew() {
  const { search } = useLocation();
  const target = parseSellerNewChat(search);
  if (!target) return <Navigate to={SELLER_CHAT_LIST_PATH} replace />;
  return <SellerConversation key={search} target={target} />;
}

function SellerConversation({ target }: { target: OpenTarget }) {
  const split = useSplitLayout();
  const navigate = useNavigate();
  const { getProduct, loading, shopOrders } = useStore();
  // 商品卡點了到買家前台的商品頁；訂單卡直達訂單管理裡那一筆（D2）
  const cardTo = (c: ChatCard) => (c.type === 'product' ? `/product/${c.id}` : orderDeepLink('/seller/orders', c.id));
  const cardGone = (c: ChatCard) => cardTargetGone(c, {
    productsLoaded: !loading,
    product: id => getProduct(id)?.status,
    hasOrder: id => shopOrders.some(o => o.id === id),
    // 店內訂單沒有「載入完成」旗標；一張訂單卡存在就代表店裡至少有一筆，所以清單非空才下「找不到訂單」的結論
    ordersLoaded: shopOrders.length > 0,
  });
  return (
    <ConversationView
      side="shop"
      target={target}
      backTo={split ? undefined : SELLER_CHAT_LIST_PATH}
      backLabel="聊聊"
      listTo={SELLER_CHAT_LIST_PATH}
      homeTo="/seller"
      ordersTo="/seller/orders"
      cardTo={cardTo}
      cardGone={cardGone}
      onCreated={id => navigate(sellerConversationPath(id), { replace: true })}
      desktopHint={split}
      className={split ? 'h-full' : undefined}
    />
  );
}
