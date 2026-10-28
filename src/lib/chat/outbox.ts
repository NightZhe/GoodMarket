// 對話頁的訊息清單與送出狀態機（純函式）。
// 兩個來源：伺服器訊息（依 seq 排序、以 id 去重）＋本機剛送出的（傳送中／失敗）。
// 本機那筆以 client id 對應：伺服器回了同 client id 的訊息，本機那筆就退場，不會出現兩則（R-M9）。
import type { ChatErrorCode } from './errors';
import type { ChatCard, ChatSide, SendArgs, ServerMessage } from './types';

// ───────── 伺服器訊息 ─────────

/** 合併並依 seq 由舊到新排好；同一個 id 只留一則（Realtime 事件重複、重連補讀） */
export function mergeServer(current: ServerMessage[], incoming: ServerMessage[]): ServerMessage[] {
  const byId = new Map<string, ServerMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * 重新讀「最新一頁」之後併進目前清單。接得上（沒有缺口）就合併、保留已載入的舊訊息；
 * 斷線太久中間有缺口，就改用最新一頁（舊的捲上去再載），避免清單中間缺幾十則卻看不出來。
 * page.messages 是由新到舊
 */
export function mergeLatest(
  current: ServerMessage[],
  page: { messages: ServerMessage[]; has_more: boolean },
  hadMore: boolean,
): { list: ServerMessage[]; hasMore: boolean } {
  if (page.messages.length === 0) return { list: current, hasMore: hadMore };
  const oldest = Math.min(...page.messages.map(m => m.seq));
  const newest = current.length > 0 ? current[current.length - 1].seq : null;
  if (newest !== null && oldest <= newest + 1) return { list: mergeServer(current, page.messages), hasMore: hadMore };
  return { list: mergeServer([], page.messages), hasMore: page.has_more };
}

// ───────── 本機送出 ─────────

export type LocalState = 'sending' | 'failed';

export interface LocalMessage {
  clientId: string;
  side: ChatSide;
  text: string | null;
  card: ChatCard | null;
  /** 本機縮圖網址（object URL），顯示用；檔案本身留在送出流程裡 */
  previews: string[];
  /** 送出時決定的參數（不含圖片路徑）；重送沿用同一份，client id 不變 */
  args: Omit<SendArgs, 'p_photos'>;
  at: string;
  state: LocalState;
  failure: ChatErrorCode | null;
}

export function createLocal(input: Omit<LocalMessage, 'state' | 'failure'>): LocalMessage {
  return { ...input, state: 'sending', failure: null };
}

const update = (list: LocalMessage[], clientId: string, patch: Partial<LocalMessage>) =>
  list.map(m => (m.clientId === clientId ? { ...m, ...patch } : m));

export const markFailed = (list: LocalMessage[], clientId: string, failure: ChatErrorCode | null): LocalMessage[] =>
  update(list, clientId, { state: 'failed', failure });

/** 重送：回到「傳送中」，client id 與參數都不變（冪等） */
export const restart = (list: LocalMessage[], clientId: string): LocalMessage[] =>
  update(list, clientId, { state: 'sending', failure: null });

/** 送出成功：本機那筆退場（伺服器回傳的那則已併進伺服器清單） */
export const confirmSent = (list: LocalMessage[], clientId: string): LocalMessage[] =>
  list.filter(m => m.clientId !== clientId);

/** 伺服器清單裡已經有的（例如 Realtime 比送出回應先到）就不再當本機訊息 */
export function dropConfirmed(list: LocalMessage[], server: ServerMessage[]): LocalMessage[] {
  const known = new Set(server.map(m => m.client_id));
  return list.filter(m => !known.has(m.clientId));
}

// ───────── 給畫面看的清單 ─────────

export type DisplayState = 'sent' | 'sending' | 'failed';

export interface DisplayMessage {
  /** React key：伺服器訊息用 client id（本機轉成伺服器訊息時 key 不變，不會重新掛載、閃一下） */
  key: string;
  clientId: string;
  id: string | null;
  seq: number | null;
  mine: boolean;
  side: ChatSide;
  text: string | null;
  card: ChatCard | null;
  /** 伺服器訊息＝私有 bucket 路徑（要換簽名網址）；本機訊息＝本機縮圖網址 */
  photos: string[];
  photosAreLocal: boolean;
  at: string;
  state: DisplayState;
  failure: ChatErrorCode | null;
}

export function visibleMessages(server: ServerMessage[], local: LocalMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = server.map(m => ({
    key: m.client_id, clientId: m.client_id, id: m.id, seq: m.seq, mine: m.mine, side: m.side,
    text: m.text, card: m.card, photos: m.photos, photosAreLocal: false, at: m.created_at, state: 'sent', failure: null,
  }));
  for (const m of dropConfirmed(local, server)) {
    out.push({
      key: m.clientId, clientId: m.clientId, id: null, seq: null, mine: true, side: m.side,
      text: m.text, card: m.card, photos: m.previews, photosAreLocal: true, at: m.at, state: m.state, failure: m.failure,
    });
  }
  return out;
}

// ───────── 送出參數 ─────────

export type OpenTarget =
  | { kind: 'conversation'; id: string }
  /** 買家：從店家頁／商品頁／訂單進，對話還不一定存在 */
  | { kind: 'shop'; shopId: string; productId?: string; orderId?: string }
  /** 店主：從訂單進（唯一的發起入口） */
  | { kind: 'order'; orderId: string };

/**
 * chat_send 的參數。三個目標參數恰好一個：
 *  - 對話已存在 → p_conversation_id（卡片以 p_card 傳種類與 id，快照由伺服器產生）
 *  - 買家、對話還不存在 → p_shop_id
 *  - 店主、對話還不存在 → p_order_id；這條路徑伺服器一律自動附訂單卡，p_card 必須是空
 */
export function buildSendArgs(a: {
  target: OpenTarget; conversationId: string | null; clientId: string; text: string; card: ChatCard | null;
}): Omit<SendArgs, 'p_photos'> {
  const args: Omit<SendArgs, 'p_photos'> = { p_client_id: a.clientId };
  const text = a.text.trim();
  if (a.conversationId) args.p_conversation_id = a.conversationId;
  else if (a.target.kind === 'shop') args.p_shop_id = a.target.shopId;
  else if (a.target.kind === 'order') args.p_order_id = a.target.orderId;
  if (text) args.p_text = text;
  if (a.card && !(a.target.kind === 'order' && !a.conversationId)) args.p_card = { type: a.card.type, id: a.card.id };
  return args;
}

/**
 * 對話已經建立（第一則回來拿到 id）之後，還在排隊的訊息改走 p_conversation_id。
 * 不然第二則仍帶 p_order_id，伺服器會再附一張訂單卡（買家的 p_shop_id 不會重複附卡，但一併統一）
 */
export function rebindToConversation(args: Omit<SendArgs, 'p_photos'>, conversationId: string): Omit<SendArgs, 'p_photos'> {
  if (args.p_conversation_id) return args;
  const { p_shop_id: _shop, p_order_id: _order, ...rest } = args;
  return { ...rest, p_conversation_id: conversationId };
}

/**
 * 對話還沒建立時送出的訊息排成一隊，一次只跑一則：前一則結束（成功或失敗）才輪到下一則。
 * 選排隊而不是停用送出鈕：第一則可能在傳圖片、很慢，停用會讓人以為壞了；失敗的第一則也不該卡住輸入
 */
export function createSendQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

// ───────── 輸入列 ─────────

export const MAX_TEXT = 1000;

/** 字數以 code point 算（emoji 一個字），去前後空白後 */
export const textLength = (text: string): number => [...text.trim()].length;

export function canSubmit(s: {
  text: string; hasCard: boolean; photoCount: number; processing: boolean;
  online: boolean; blockedByMe: boolean; peerDeleted: boolean;
}): boolean {
  if (!s.online || s.blockedByMe || s.peerDeleted || s.processing) return false;
  const len = textLength(s.text);
  if (len > MAX_TEXT) return false;
  return len > 0 || s.hasCard || s.photoCount > 0;
}

// ───────── 圖片位置 ─────────

/** 位置 30 分鐘有效。重送時還剩 2 分鐘以上才沿用已上傳的路徑，不然重新申請、重傳（SLOT_INVALID） */
export const SLOT_MARGIN_MS = 2 * 60 * 1000;

export function slotsReusable(slots: { expires_at: string }[], now: number): boolean {
  return slots.length > 0 && slots.every(s => Date.parse(s.expires_at) - now > SLOT_MARGIN_MS);
}

// ───────── 新訊息宣告（live region，§8.7） ─────────

const snippet = (m: ServerMessage): string => {
  const t = m.text?.trim();
  if (t) return [...t].length > 40 ? `${[...t].slice(0, 40).join('')}…` : t;
  if (m.photos.length > 0) return '圖片';
  return m.card?.type === 'order' ? '訂單卡' : '商品卡';
};

/** 一次補到的對方新訊息宣告一句：1 則念內容、多則念則數。沒有新訊息回 null */
export function incomingAnnouncement(fresh: ServerMessage[]): string | null {
  if (fresh.length === 0) return null;
  return fresh.length === 1 ? `新訊息：${snippet(fresh[0])}` : `收到 ${fresh.length} 則新訊息`;
}
