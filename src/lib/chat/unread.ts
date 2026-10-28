import type { ChatSide, UnreadSummary } from './types';

/** 角標與列表未讀數的顯示：0 不顯示（空字串）、超過 99 顯示 99+ */
export function formatUnread(n: number): string {
  if (!(n > 0)) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** 有未讀的「對話數」（不是訊息數）：同一條對話 3 則未讀只算 1 */
export function unreadConversationCount(rows: { unread_count: number }[]): number {
  return rows.reduce((n, r) => (r.unread_count > 0 ? n + 1 : n), 0);
}

const safe = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** 這個身分的角標數：買家端只算買家側、賣家中心只算店家側 */
export function badgeCount(s: UnreadSummary, side: ChatSide): number {
  return safe(side === 'buyer' ? s.buyer_conversations : s.shop_conversations);
}

/** tab／底欄／側欄的朗讀名稱（沿用 ordersNavLabel 的做法） */
export function chatNavLabel(n: number): string {
  if (!(n > 0)) return '聊聊';
  return n > 99 ? '聊聊，99 條以上未讀' : `聊聊，${n} 條未讀`;
}

/** 賣場總覽的提示卡文字；0 則不顯示（回 null） */
export function unreadOverview(messages: number): string | null {
  const n = safe(messages);
  if (n === 0) return null;
  return `你有 ${n > 99 ? '99+' : n} 則未讀訊息`;
}
