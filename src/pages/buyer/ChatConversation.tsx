import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import ConversationView from '../../components/chat/ConversationView';
import { useStore } from '../../store/StoreContext';
import { cardTargetGone } from '../../lib/chat/cards';
import { orderDeepLink } from '../../lib/orders/deeplink';
import { CHAT_LIST_PATH, conversationPath, parseNewChat } from '../../lib/chat/nav';
import type { OpenTarget } from '../../lib/chat/outbox';
import type { ChatCard } from '../../lib/chat/types';

/** 買家的對話頁。路由兩種：#/chat/:conversationId（既有對話）、#/chat/new?shop=…（從店家頁／商品頁／訂單進，對話還不一定存在） */
export function ChatThread() {
  const { conversationId = '' } = useParams();
  return <BuyerConversation key={conversationId} target={{ kind: 'conversation', id: conversationId }} />;
}

export function ChatNew() {
  const { search } = useLocation();
  const target = parseNewChat(search);
  if (!target) return <Navigate to={CHAT_LIST_PATH} replace />;
  return <BuyerConversation key={search} target={target} />;
}

function BuyerConversation({ target }: { target: OpenTarget }) {
  const { getShop, getProduct, loading, myOrders, myOrdersState } = useStore();
  const navigate = useNavigate();
  const fallbackName = target.kind === 'shop' ? getShop(target.shopId)?.name : undefined;

  // 商品卡到商品頁；訂單卡直達我的訂單裡那一筆（D2）
  const cardTo = (c: ChatCard) => (c.type === 'product' ? `/product/${c.id}` : orderDeepLink('/orders', c.id));
  const cardGone = (c: ChatCard) => cardTargetGone(c, {
    productsLoaded: !loading,
    product: id => getProduct(id)?.status,
    hasOrder: id => myOrders.some(o => o.id === id),
    ordersLoaded: myOrdersState === 'ready',
  });

  return (
    <ConversationView
      side="buyer"
      target={target}
      backTo={CHAT_LIST_PATH}
      backLabel="聊聊"
      listTo={CHAT_LIST_PATH}
      homeTo="/"
      ordersTo="/orders"
      fallbackName={fallbackName}
      cardTo={cardTo}
      cardGone={cardGone}
      onHidden={() => navigate(CHAT_LIST_PATH, { replace: true })}
      onCreated={id => navigate(conversationPath(id), { replace: true })}
    />
  );
}
