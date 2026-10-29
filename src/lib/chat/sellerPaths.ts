// 賣家中心聊聊的路由（純函式）。買家端的路徑在 nav.ts；賣家端獨立一份，不動買家的檔。
//   /seller/chat                  列表（桌機：左列表右對話）
//   /seller/chat/:conversationId  既有對話
//   /seller/chat/new?order=…      從訂單卡「聯絡買家」進（對話還不一定存在，由 chat_open_for_order 決定）
import type { OpenTarget } from './outbox';

export const SELLER_CHAT_LIST_PATH = '/seller/chat';

export const sellerConversationPath = (id: string): string => `${SELLER_CHAT_LIST_PATH}/${encodeURIComponent(id)}`;

export const sellerNewChatPath = (orderId: string): string => `${SELLER_CHAT_LIST_PATH}/new?order=${encodeURIComponent(orderId)}`;

/** 解析 /seller/chat/new 的查詢；沒有訂單編號就無效（賣家不能無中生有發起對話） */
export function parseSellerNewChat(search: string): Extract<OpenTarget, { kind: 'order' }> | null {
  const orderId = new URLSearchParams(search).get('order');
  return orderId ? { kind: 'order', orderId } : null;
}
