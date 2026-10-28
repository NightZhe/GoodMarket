import { supabase } from '../supabase';
import { withAbortTimeout } from '../rpcTimeout';
import { ChatError, toChatError } from './errors';
import type {
  ChatListPage, ChatSide, MessagesPage, OpenAsBuyer, OpenForOrder, SendArgs, ServerMessage, UnreadSummary, UploadSlot,
} from './types';

// 聊聊所有對 Supabase 的呼叫都集中在這個檔（RPC、Storage、Realtime）。其他檔案不直接碰 supabase：
// 介面有調整時只改這裡。錯誤碼在 error.hint，轉成 ChatError 往上丟；code null＝網路中斷或逾時，可以重試。

export const BUCKET = 'chat-images';
const RPC_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { value, timedOut } = await withAbortTimeout(RPC_TIMEOUT_MS, async signal => {
    try {
      return await supabase.rpc(fn, args).abortSignal(signal);
    } catch (e) {
      // 網路層直接丟例外（部分環境不回 error 物件）：當成沒有錯誤碼的網路錯誤
      if (signal.aborted) throw e;
      return { data: null, error: { message: e instanceof Error ? e.message : '網路連線失敗' }, status: 0 };
    }
  });
  if (timedOut || !value) throw new ChatError('連線逾時', null);
  const { data, error, status } = value as { data: unknown; error: { message?: string; code?: string; hint?: string | null } | null; status: number };
  if (error) throw toChatError({ message: error.message, code: error.code, hint: error.hint, status });
  return data as T;
}

// ───────── RPC ─────────

/** 買家進對話頁：不建立對話。pending_card＝帶商品／訂單進來時的待送出卡片 */
export const chatOpen = (shopId: string, productId?: string, orderId?: string) =>
  rpc<OpenAsBuyer>('chat_open', { p_shop_id: shopId, p_product_id: productId ?? null, p_order_id: orderId ?? null });

/** 店主從訂單進對話頁（賣家唯一的發起入口） */
export const chatOpenForOrder = (orderId: string) => rpc<OpenForOrder>('chat_open_for_order', { p_order_id: orderId });

/** 送出一則訊息。p_client_id 由客戶端產生，重送同一個 id 不會產生第二則（R-M9） */
export const chatSend = (args: SendArgs) => rpc<ServerMessage>('chat_send', { ...args });

export const chatList = (side: ChatSide, cursor?: ChatListPage['next_cursor'], limit?: number) =>
  rpc<ChatListPage>('chat_list', { p_side: side, p_cursor: cursor ?? null, p_limit: limit ?? null });

/** 讀一條對話的訊息，由新到舊。before＝已載入的最舊一則的 seq */
export const chatMessages = (conversationId: string, before?: number, limit?: number) =>
  rpc<MessagesPage>('chat_messages', { p_conversation_id: conversationId, p_before: before ?? null, p_limit: limit ?? null });

export const chatMarkRead = (conversationId: string) =>
  rpc<{ conversation_id: string; read_seq: number }>('chat_mark_read', { p_conversation_id: conversationId });

export const chatUnreadSummary = () => rpc<UnreadSummary>('chat_unread_summary');

export const chatHide = (conversationId: string) => rpc<{ conversation_id: string; hidden: boolean }>('chat_hide', { p_conversation_id: conversationId });

export const chatBlock = (conversationId: string) => rpc<{ conversation_id: string; blocked_by_me: boolean }>('chat_block', { p_conversation_id: conversationId });

export const chatUnblock = (conversationId: string) => rpc<{ conversation_id: string; blocked_by_me: boolean }>('chat_unblock', { p_conversation_id: conversationId });

/** 申請 1～5 個圖片位置（綁呼叫者，買家側與店家側共用），30 分鐘有效 */
export const requestChatUpload = (count: number) => rpc<UploadSlot[]>('chat_request_upload', { p_count: count });

// ───────── Storage（私有 bucket） ─────────

/** 把壓縮後的 JPEG 傳到資料庫發的位置。不用 upsert；409＝這個路徑已經有檔案（上一次其實成功了只是沒收到回應），視為成功 */
export async function uploadChatImage(path: string, blob: Blob): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ChatError('圖片上傳逾時', null)), UPLOAD_TIMEOUT_MS);
  });
  try {
    const { error } = await Promise.race([
      supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
      timeout,
    ]).catch(e => {
      if (e instanceof ChatError) throw e;
      // 網路層直接丟例外：當成沒有狀態碼的網路錯誤
      return { error: { message: e instanceof Error ? e.message : '網路連線失敗' } };
    });
    if (!error) return;
    const e = error as { status?: number | string; statusCode?: number | string; message: string };
    const status = Number(e.statusCode ?? e.status);
    if (status === 409) return;
    // 位置過期、檔案太大、不是 JPEG：重送也不會成功，要重新申請位置（或換圖）
    if (status === 400 || status === 403 || status === 413 || status === 415) throw new ChatError(e.message, 'SLOT_INVALID');
    throw new ChatError(e.message, null);
  } finally {
    clearTimeout(timer);
  }
}

export const SIGNED_URL_TTL_S = 60 * 60;

/** 私有圖片的簽名網址（短效）。讀不到的路徑不在結果裡 */
export async function signChatImages(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S);
  if (error) throw new ChatError(error.message, null);
  const out: Record<string, string> = {};
  for (const row of data) if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  return out;
}

// ───────── Realtime（私有頻道，只推 id；內容經 RPC 重讀，R-M22） ─────────

export type ChannelStatus = 'subscribed' | 'lost';

/**
 * 訂閱一個私有廣播頻道（conversation:<id> 事件 message／user:<uid> 事件 summary）。
 * onStatus：'subscribed' 每次（含斷線後自動重連成功）都會來，呼叫端據此補讀；'lost'＝逾時、錯誤或被關閉。
 * 回傳取消訂閱的函式
 */
export function subscribeTopic(topic: string, event: string, onEvent: () => void, onStatus?: (s: ChannelStatus) => void): () => void {
  const channel = supabase.channel(topic, { config: { private: true } });
  let cancelled = false;
  // 私有頻道加入時以目前的登入身分評估授權：先把 token 交給 Realtime 再訂閱（supabase-js 登入／換 token 時也會自動做，這裡是保險）
  void supabase.realtime.setAuth().then(() => {
    if (cancelled) return;
    channel
      .on('broadcast', { event }, () => onEvent())
      .subscribe(status => {
        if (status === 'SUBSCRIBED') onStatus?.('subscribed');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('lost');
      });
  });
  return () => { cancelled = true; void supabase.removeChannel(channel); };
}
