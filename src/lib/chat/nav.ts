// 路由與導覽設定（純函式）。路徑形式：
//   /chat                 聊聊列表
//   /chat/:conversationId 既有對話
//   /chat/new?shop=…&product=…｜&order=…   從店家頁／商品頁／訂單進（對話還不一定存在，由 chat_open 決定）
import { chatNavLabel } from './unread';
import type { OpenTarget } from './outbox';
import type { Counterpart } from './types';

export const CHAT_LIST_PATH = '/chat';

export const conversationPath = (id: string): string => `${CHAT_LIST_PATH}/${encodeURIComponent(id)}`;

/** 商品與訂單不會同時帶：商品優先 */
export function newChatPath(a: { shopId: string; productId?: string; orderId?: string }): string {
  const q = [`shop=${encodeURIComponent(a.shopId)}`];
  if (a.productId) q.push(`product=${encodeURIComponent(a.productId)}`);
  else if (a.orderId) q.push(`order=${encodeURIComponent(a.orderId)}`);
  return `${CHAT_LIST_PATH}/new?${q.join('&')}`;
}

/** 解析 /chat/new 的查詢；缺 shop、或同時帶商品與訂單都視為無效 */
export function parseNewChat(search: string): Extract<OpenTarget, { kind: 'shop' }> | null {
  const p = new URLSearchParams(search);
  const shopId = p.get('shop');
  const productId = p.get('product');
  const orderId = p.get('order');
  if (!shopId || (productId && orderId)) return null;
  return { kind: 'shop', shopId, ...(productId ? { productId } : {}), ...(orderId ? { orderId } : {}) };
}

/** 對話頁（/chat/…）有自己的輸入列與鍵盤，不顯示底部 tab bar；列表頁（/chat）要顯示 */
export const isChatConversationPath = (pathname: string): boolean => /^\/chat\/[^/]+/.test(pathname);

export type ChatAvailability = 'unknown' | 'ok' | 'unavailable';

/**
 * 商品頁／店家頁／訂單卡上的入口鈕要不要顯示。降級（資料庫未升級，R-M24）與「還沒確認可用」都隱藏；
 * 自己的店不顯示（R-M2）；本機封鎖的店不顯示（設計 Q3，兩種封鎖不同步）；沒有店主的店（示範資料）沒人能回覆，伺服器會回 SHOP_NOT_FOUND，也不顯示
 */
export function chatEntryVisible(s: { availability: ChatAvailability; ownShop: boolean; locallyBlocked: boolean; ownerKnownMissing?: boolean }): boolean {
  return s.availability === 'ok' && !s.ownShop && !s.locallyBlocked && !s.ownerKnownMissing;
}

export function buyerChatTab(badge: number) {
  return { to: CHAT_LIST_PATH, label: '聊聊', ariaLabel: chatNavLabel(badge), badge };
}

export interface PeerView {
  name: string;
  /** 頭像取首字用；空字串＝預設頭像 */
  letter: string;
  deleted: boolean;
  /** 買家端可點到店家頁的店 id；店已關閉或對方是買家時 null */
  shopId: string | null;
}

/** 對話對象的顯示：買家看店、店主看買家。刪帳號／關店後固定文案（§6.8） */
export function peerView(c: Counterpart): PeerView {
  if (c.kind === 'shop') {
    if (c.deleted || !c.name) return { name: '已關閉的賣場', letter: '', deleted: true, shopId: null };
    return { name: c.name, letter: c.name, deleted: false, shopId: c.shop_id };
  }
  if (c.deleted) return { name: '已刪除的帳號', letter: '', deleted: true, shopId: null };
  const nick = c.nickname?.trim();
  if (nick) return { name: nick, letter: nick, deleted: false, shopId: null };
  return { name: c.short_code ? `買家 ${c.short_code}` : '買家', letter: '買', deleted: false, shopId: null };
}
