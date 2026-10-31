// 脈絡列（D10）：列表每一列與對話頁標題下方那一行小字，告訴看的人「這條對話在問哪一件」。
// 內容＝這段對話最近一張卡：訂單卡「訂單 #<order_no 末 6 碼> · <商品名>」、商品卡「<商品名>」、沒有卡片就不顯示。
// 商品名的截斷交給 CSS（單行 truncate），這裡只組字串；order_no 不足 6 碼就整個顯示。
import type { DisplayMessage } from './outbox';
import type { ChatCard, LastCard } from './types';

export const ORDER_NO_TAIL = 6;

/** 訂單編號只露末 6 碼：列表一行放不下 14 碼，而且末 6 碼已足夠對照訂單頁 */
export const orderNoTail = (orderNo: string): string => [...orderNo].slice(-ORDER_NO_TAIL).join('');

/**
 * 脈絡列文字。接受列表 RPC 的 last_card（舊資料庫沒有這個鍵＝undefined）或對話頁訊息裡的整張卡；
 * 沒有卡、或卡片沒有商品名也沒有訂單編號 → null（呼叫端不渲染那一行，版面不跳）
 */
export function contextLine(card: LastCard | ChatCard | null | undefined): string | null {
  if (!card) return null;
  const title = card.title?.trim() ?? '';
  if (card.type === 'order') {
    const no = card.order_no?.trim() ?? '';
    if (!no && !title) return null;
    if (!no) return title;
    return title ? `訂單 #${orderNoTail(no)} · ${title}` : `訂單 #${orderNoTail(no)}`;
  }
  return title || null;
}

/** 對話頁用：已載入訊息（由舊到新）裡最新一則帶卡片的訊息的卡。送出失敗的那則不算（它還沒到對方那邊） */
export function lastCardOf(messages: DisplayMessage[]): ChatCard | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.card && m.state !== 'failed') return m.card;
  }
  return null;
}
