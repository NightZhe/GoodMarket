// 訊息裡的商品卡／訂單卡：文字與朗讀、點擊時目標還在不在（純函式）。卡片內容是送出當下的快照，之後不會改。
import type { ChatCard } from './types';

const STATUS_LABEL: Record<string, string> = { to_ship: '待出貨', shipping: '運送中', completed: '已完成', cancelled: '已取消' };

/** 訂單送出當下的狀態（中文）；不認得的照原字 */
export const orderStatusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

/** 卡片上的金額：商品卡是快照價（可能沒有），訂單卡是訂單金額 */
export const cardPrice = (card: ChatCard): number | null => (card.type === 'product' ? card.price : card.total);

const itemsText = (c: Extract<ChatCard, { type: 'order' }>) =>
  c.item_count > 1 ? `${c.title}等 ${c.item_count} 件` : `${c.title}，${Math.max(1, c.item_count)} 件`;

/** 對話裡一張卡的朗讀（設計 9.2）。gone＝點下去的目標已不存在 */
export function cardSpoken(card: ChatCard, gone: boolean): string {
  if (card.type === 'product') {
    const parts = ['商品卡', card.title];
    if (card.price !== null) parts.push(`${card.price} 元`);
    if (gone) parts.push('商品已下架');
    return parts.join('，');
  }
  const parts = ['訂單卡', `訂單 ${card.order_no}`, itemsText(card), `訂單金額 ${card.total} 元`, `送出時狀態${orderStatusLabel(card.status)}`];
  if (gone) parts.push('找不到訂單');
  return parts.join('，');
}

export const pendingCardKicker = (card: ChatCard): string => `${card.type === 'product' ? '商品' : '訂單'}・隨訊息送出`;

/** 輸入列上方「待送出卡片」的朗讀。removable＝false（店主發起新對話的訂單卡）改念為什麼拿不掉 */
export function pendingCardSpoken(card: ChatCard, removable: boolean): string {
  const tail = removable ? '隨訊息一起送出' : '第一則訊息會附上這筆訂單';
  if (card.type === 'product') {
    const price = card.price !== null ? `，${card.price} 元` : '';
    return `待送出的商品卡，${card.title}${price}，${tail}`;
  }
  return `待送出的訂單卡，訂單 ${card.order_no}，${itemsText(card)}，訂單金額 ${card.total} 元，${tail}`;
}

export interface CardLookup {
  productsLoaded: boolean;
  product: (id: string) => 'active' | 'hidden' | undefined;
  hasOrder: (id: string) => boolean;
  /** 訂單清單載入完成了嗎；沒載好之前不下「找不到訂單」的結論 */
  ordersLoaded?: boolean;
}

/** 點卡片時目標還在不在。資料還沒載好時一律當作還在（不對使用者說謊） */
export function cardTargetGone(card: ChatCard, l: CardLookup): boolean {
  if (card.type === 'product') return l.productsLoaded && l.product(card.id) !== 'active';
  return l.ordersLoaded === true && !l.hasOrder(card.id);
}
