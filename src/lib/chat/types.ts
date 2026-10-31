// 聊聊的資料形狀（對齊資料庫 RPC 的回傳，見 .work/chat/interface-chat.md 與 migration 20261028231648_chat.sql）。

/** 對話的哪一側：買家側／店家側（店主操作） */
export type ChatSide = 'buyer' | 'shop';

export type CardType = 'product' | 'order';

/** 商品卡：送出當下的快照（價格不是現價） */
export interface ProductCardData {
  type: 'product';
  id: string;
  title: string;
  image: string;
  price: number | null;
}

/** 訂單卡：送出當下的快照（status 是送出時的狀態） */
export interface OrderCardData {
  type: 'order';
  id: string;
  order_no: string;
  title: string;
  image: string;
  item_count: number;
  total: number;
  status: string;
}

export type ChatCard = ProductCardData | OrderCardData;

/** 伺服器回傳的一則訊息 */
export interface ServerMessage {
  id: string;
  conversation_id: string;
  /** 對話內單調遞增的序號：排序、分頁、重連補讀都用它 */
  seq: number;
  side: ChatSide;
  mine: boolean;
  client_id: string;
  text: string | null;
  card: ChatCard | null;
  /** 私有 bucket 內的路徑，要換簽名網址才讀得到 */
  photos: string[];
  created_at: string;
}

export type Counterpart =
  | { kind: 'shop'; deleted: boolean; shop_id: string | null; name: string | null; avatar: string | null }
  | { kind: 'buyer'; deleted: boolean; nickname: string | null; short_code: string | null };

export interface LastMessage {
  side: ChatSide;
  mine: boolean;
  text: string | null;
  photo_count: number;
  card_type: CardType | null;
  at: string;
}

/** 列表每列的「最近一張卡」摘要（脈絡列用，D10）：只有畫面要的四個鍵；商品卡的 order_no 是 null */
export interface LastCard {
  type: CardType;
  id: string;
  title: string;
  order_no: string | null;
}

export interface ConversationRow {
  conversation_id: string;
  counterpart: Counterpart;
  last_message: LastMessage;
  last_message_at: string;
  unread_count: number;
  blocked_by_me: boolean;
  /** 這條對話最近一則帶卡片訊息的卡；沒有卡片是 null。舊資料庫（沒套 20261101120000_chat_last_card）不回這個鍵＝undefined，前端一律當 null */
  last_card?: LastCard | null;
}

export interface ListCursor { at: string; id: string }

export interface ChatListPage { items: ConversationRow[]; next_cursor: ListCursor | null }

/** 買家進對話頁（chat_open） */
export interface OpenAsBuyer {
  conversation_id: string | null;
  shop: { id: string; name: string; avatar: string | null };
  counterpart_deleted: boolean;
  blocked_by_me: boolean;
  pending_card: ChatCard | null;
}

/** 店主從訂單進對話頁（chat_open_for_order） */
export interface OpenForOrder {
  conversation_id: string | null;
  buyer: { nickname: string | null; short_code: string | null };
  counterpart_deleted: boolean;
  blocked_by_me: boolean;
  order_card: OrderCardData;
}

export interface ConversationMeta {
  id: string;
  side: ChatSide;
  counterpart: Counterpart;
  counterpart_deleted: boolean;
  blocked_by_me: boolean;
  last_seq: number;
}

/** chat_messages：訊息由新到舊 */
export interface MessagesPage { conversation: ConversationMeta; messages: ServerMessage[]; has_more: boolean }

export interface UnreadSummary {
  /** 我當買家、有未讀的對話數（買家 tab 角標） */
  buyer_conversations: number;
  /** 我的店、有未讀的對話數（賣家底欄角標） */
  shop_conversations: number;
  /** 我的店的未讀訊息總數（總覽提示卡） */
  shop_messages: number;
}

export const EMPTY_SUMMARY: UnreadSummary = { buyer_conversations: 0, shop_conversations: 0, shop_messages: 0 };

export interface UploadSlot { path: string; expires_at: string }

/** 傳給 chat_send 的目標與內容（三個目標參數恰好一個） */
export interface SendArgs {
  p_client_id: string;
  p_conversation_id?: string;
  p_shop_id?: string;
  p_order_id?: string;
  p_text?: string;
  p_card?: { type: CardType; id: string };
  p_photos?: string[];
}
