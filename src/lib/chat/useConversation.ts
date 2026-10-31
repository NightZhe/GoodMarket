import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/StoreContext';
import { useChat } from '../../store/ChatContext';
import {
  chatBlock, chatHide, chatMarkRead, chatMessages, chatOpen, chatOpenForOrder, chatSend, chatUnblock, requestChatUpload, subscribeTopic, uploadChatImage,
} from './api';
import { errorCodeOf, isUnavailable, openFailure, sendFailureText, type OpenFailure } from './errors';
import {
  buildSendArgs, confirmSent, createLocal, createSendQueue, incomingAnnouncement, markFailed, mergeLatest, mergeServer, pendingCardFor, rebindToConversation, restart, slotsReusable,
  visibleMessages,
  type DisplayMessage, type LocalMessage, type OpenTarget,
} from './outbox';
import { peerView, type PeerView } from './nav';
import type { ChatCard, ChatSide, MessagesPage, ServerMessage, UploadSlot } from './types';

export type ConversationPhase = 'loading' | 'ready' | OpenFailure;

/** key 每次不同：同一句話連續宣告兩次，live region 也要再念一次 */
export interface Announcement { key: number; text: string }

export interface OutgoingPhoto { blob: Blob; previewUrl: string }

/**
 * 一條對話的全部狀態與動作（買家端與賣家端共用，side／target 不同）。
 * 載入 → 即時（Realtime 只通知「有新訊息」，內容經 RPC 重讀，以訊息 id 去重）→ 標已讀 → 往上載入更早 →
 * 送出（本機先顯示「傳送中」，client id 冪等，失敗可重送）→ 封鎖／隱藏。
 * 呼叫端用 key={target} 讓換對話時整個重來，所以 side／target 在這個 hook 的生命週期內不變
 */
export function useConversation(side: ChatSide, target: OpenTarget, onCreated?: (conversationId: string) => void, onFirstSent?: () => void) {
  const { user, authReady } = useStore();
  // 用 id 當依賴：token 更新（例如回前景）會換 user 物件，但不需要重讀整條對話（B2）
  const userId = user?.id ?? null;
  const { refresh: refreshSummary, markUnavailable } = useChat();
  const sideRef = useRef(side);
  const targetRef = useRef(target);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const onFirstSentRef = useRef(onFirstSent);
  onFirstSentRef.current = onFirstSent;
  /** 「我在這條對話的第一則」已經通知過（一條對話只通知一次；顯示名稱邀請 D11 用） */
  const firstSentNotified = useRef(false);
  /** 這次是由第一則訊息建立的對話，網址還停在「新對話」 */
  const createdHere = useRef(false);
  const mounted = useRef(true);

  const [phase, setPhase] = useState<ConversationPhase>('loading');
  const [convId, setConvId] = useState<string | null>(target.kind === 'conversation' ? target.id : null);
  const convIdRef = useRef(convId);
  const [peer, setPeer] = useState<PeerView | null>(null);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [peerDeleted, setPeerDeleted] = useState(false);
  const [server, setServer] = useState<ServerMessage[]>([]);
  const serverRef = useRef<ServerMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const hasMoreRef = useRef(false);
  const [local, setLocal] = useState<LocalMessage[]>([]);
  const [pendingCard, setPendingCard] = useState<ChatCard | null>(null);
  const [cardRemovable, setCardRemovable] = useState(true);
  const [messagesFailed, setMessagesFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [incoming, setIncoming] = useState<Announcement | null>(null);
  const [failure, setFailure] = useState<Announcement | null>(null);
  const [reload, setReload] = useState(0);
  const tick = useRef(0);

  /** 送出過的訊息（重送沿用同一份參數與 client id） */
  const entries = useRef(new Map<string, LocalMessage>());
  /** 對話建立之前送出的訊息排隊，一則一則來 */
  const openingQueue = useRef(createSendQueue());
  const blobs = useRef(new Map<string, Blob[]>());
  const uploaded = useRef(new Map<string, UploadSlot[]>());
  const previewUrls = useRef<string[]>([]);

  const applyServer = useCallback((next: ServerMessage[]) => {
    serverRef.current = next;
    setServer(next);
  }, []);
  const applyHasMore = useCallback((v: boolean) => {
    hasMoreRef.current = v;
    setHasMore(v);
  }, []);
  const applyConvId = useCallback((id: string | null) => {
    convIdRef.current = id;
    setConvId(id);
  }, []);
  const applyMeta = useCallback((page: MessagesPage) => {
    setBlockedByMe(page.conversation.blocked_by_me);
    setPeerDeleted(page.conversation.counterpart_deleted);
    setPeer(peerView(page.conversation.counterpart));
  }, []);

  /** 呼叫失敗時：發現資料庫沒有聊聊函式就全站降級（R-M24），其他錯誤不在這裡處理 */
  const noteFailure = useCallback((e: unknown) => { if (isUnavailable(e)) markUnavailable(); }, [markUnavailable]);

  /** 頁面在前景時，把這條對話標已讀並更新角標（R-M14）。失敗不打擾使用者：未讀狀態沒變，下一次事件／回前景會再試 */
  const markRead = useCallback(async () => {
    const id = convIdRef.current;
    if (!id || document.visibilityState !== 'visible') return;
    try {
      await chatMarkRead(id);
    } catch (e) {
      noteFailure(e);
      return;
    }
    void refreshSummary();
  }, [noteFailure, refreshSummary]);

  /** 重新讀最新一頁併進清單（收到事件、頻道重連、回前景、網路恢復）。失敗就保留畫面，下次時機再讀 */
  const refetch = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    try {
      const page = await chatMessages(id);
      const known = new Set(serverRef.current.map(m => m.id));
      const fresh = page.messages.filter(m => !known.has(m.id) && !m.mine);
      const merged = mergeLatest(serverRef.current, page, hasMoreRef.current);
      applyServer(merged.list);
      applyHasMore(merged.hasMore);
      applyMeta(page);
      setMessagesFailed(false);
      const text = incomingAnnouncement(fresh);
      if (text) {
        setIncoming({ key: ++tick.current, text });
        void markRead();
      }
    } catch (e) {
      noteFailure(e);
    }
  }, [applyHasMore, applyMeta, applyServer, markRead, noteFailure]);

  // ───────── 載入 ─────────
  useEffect(() => {
    if (!authReady) return;
    if (!userId) { setPhase('login'); return; }
    let alive = true;
    const t = targetRef.current;
    setPhase('loading');
    setMessagesFailed(false);
    void (async () => {
      try {
        let id: string | null = t.kind === 'conversation' ? t.id : null;
        let page: MessagesPage | null = null;
        let card: ChatCard | null = null;
        if (t.kind === 'conversation') {
          page = await chatMessages(t.id);
        } else if (t.kind === 'shop') {
          const o = await chatOpen(t.shopId, t.productId, t.orderId);
          if (!alive) return;
          setPeer(peerView({ kind: 'shop', deleted: o.counterpart_deleted, shop_id: o.shop.id, name: o.shop.name, avatar: o.shop.avatar }));
          setBlockedByMe(o.blocked_by_me);
          setPeerDeleted(o.counterpart_deleted);
          card = o.pending_card;
          id = o.conversation_id;
        } else {
          const o = await chatOpenForOrder(t.orderId);
          if (!alive) return;
          setPeer(peerView({ kind: 'buyer', deleted: o.counterpart_deleted, nickname: o.buyer.nickname, short_code: o.buyer.short_code }));
          setBlockedByMe(o.blocked_by_me);
          setPeerDeleted(o.counterpart_deleted);
          card = o.order_card;
          // 還沒有對話時，訂單卡是伺服器唯一能認出對象的依據，不能移除（§6.4）
          setCardRemovable(o.conversation_id !== null);
          id = o.conversation_id;
        }
        if (id && !page) {
          try {
            page = await chatMessages(id);
          } catch (e) {
            if (!alive) return;
            if (isUnavailable(e)) throw e;
            setMessagesFailed(true);
          }
        }
        if (!alive) return;
        applyConvId(id);
        // 最後一則就是這張卡（回前景重讀、重新整理網址）才不再待送出
        setPendingCard(pendingCardFor(card, page?.messages ?? [], [...entries.current.values()]));
        if (page) {
          applyMeta(page);
          applyServer(mergeServer([], page.messages));
          applyHasMore(page.has_more);
        }
        setPhase('ready');
        void markRead();
      } catch (e) {
        if (!alive) return;
        const kind = openFailure(e);
        if (kind === 'unavailable') markUnavailable();
        setPhase(kind);
      }
    })();
    return () => { alive = false; };
  }, [authReady, userId, reload, applyConvId, applyHasMore, applyMeta, applyServer, markRead, markUnavailable]);

  const retryLoad = useCallback(() => setReload(n => n + 1), []);

  // 開頁時就沒網路：恢復連線後自動重讀（AC-M24）
  useEffect(() => {
    if (phase !== 'offline') return;
    window.addEventListener('online', retryLoad);
    return () => window.removeEventListener('online', retryLoad);
  }, [phase, retryLoad]);

  // ───────── 即時 ─────────
  useEffect(() => {
    if (phase !== 'ready' || !convId) return;
    return subscribeTopic(`conversation:${convId}`, 'message', () => { void refetch(); }, s => { if (s === 'subscribed') void refetch(); });
  }, [phase, convId, refetch]);

  // 回前景、網路恢復：補讀斷線期間的訊息並標已讀
  useEffect(() => {
    if (phase !== 'ready') return;
    const onVisible = () => { if (document.visibilityState === 'visible') { void refetch(); void markRead(); } };
    const onOnline = () => { void refetch(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); };
  }, [phase, refetch, markRead]);

  // 離開頁面：釋放本機縮圖
  useEffect(() => () => { previewUrls.current.forEach(u => URL.revokeObjectURL(u)); }, []);
  // 使用者已經離開就不要再替他換網址
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ───────── 往上載入更早 ─────────
  const loadMore = useCallback(async () => {
    const id = convIdRef.current;
    const oldest = serverRef.current[0];
    if (!id || !oldest || loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await chatMessages(id, oldest.seq);
      applyServer(mergeServer(serverRef.current, page.messages));
      applyHasMore(page.has_more);
    } catch (e) {
      noteFailure(e);
      setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [applyHasMore, applyServer, noteFailure]);

  /** 第一頁訊息沒讀到（但對話存在）時的重試 */
  const retryMessages = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    try {
      const page = await chatMessages(id);
      applyMeta(page);
      applyServer(mergeServer(serverRef.current, page.messages));
      applyHasMore(page.has_more);
      setMessagesFailed(false);
      void markRead();
    } catch (e) {
      noteFailure(e);
    }
  }, [applyHasMore, applyMeta, applyServer, markRead, noteFailure]);

  // ───────── 送出 ─────────
  const run = useCallback(async (queued: LocalMessage) => {
    // 排隊等到的：第一則已經建好對話，改走既有對話，不再帶 p_order_id／p_shop_id
    const readyId = convIdRef.current;
    const entry = readyId && !queued.args.p_conversation_id ? { ...queued, args: rebindToConversation(queued.args, readyId) } : queued;
    if (entry !== queued) entries.current.set(entry.clientId, entry);
    const files = blobs.current.get(entry.clientId) ?? [];
    try {
      let slots = uploaded.current.get(entry.clientId) ?? null;
      if (files.length > 0 && !(slots && slotsReusable(slots, Date.now()))) {
        slots = await requestChatUpload(files.length);
        // 申請到就先記下來：上傳到一半失敗、重送時沿用同一批位置（已傳好的路徑再傳回 409，視為成功），不重複申請（未用位置上限 50）
        uploaded.current.set(entry.clientId, slots);
        await Promise.all(slots.map((s, i) => uploadChatImage(s.path, files[i])));
      }
      // 送出前這條對話還沒有任何一則自己的訊息 → 這一則是我的第一則（已載入的最新一頁沒有，就當沒有）
      const firstOwn = !serverRef.current.some(x => x.mine);
      const msg = await chatSend({ ...entry.args, ...(files.length > 0 && slots ? { p_photos: slots.map(s => s.path) } : {}) });
      if (!convIdRef.current) {
        applyConvId(msg.conversation_id);
        createdHere.current = true;
      }
      applyServer(mergeServer(serverRef.current, [msg]));
      setLocal(l => confirmSent(l, entry.clientId));
      blobs.current.delete(entry.clientId);
      uploaded.current.delete(entry.clientId);
      entries.current.delete(entry.clientId);
      if (firstOwn && !firstSentNotified.current && mounted.current) {
        firstSentNotified.current = true;
        onFirstSentRef.current?.();
      }
      // 第一則建立了對話：全部送完（沒有排隊中或失敗待重送的）再把網址換成這條對話，重新整理才不會又長出待送出卡片；
      // 還有沒送完的就等它們，免得換頁重載把傳送中／失敗的狀態弄丟
      if (createdHere.current && entries.current.size === 0 && mounted.current) {
        createdHere.current = false;
        onCreatedRef.current?.(msg.conversation_id);
      }
    } catch (e) {
      const code = errorCodeOf(e);
      noteFailure(e);
      // 位置失效：下一次重送要重新申請並重傳
      if (code === 'SLOT_INVALID') uploaded.current.delete(entry.clientId);
      setLocal(l => markFailed(l, entry.clientId, code));
      setFailure({ key: ++tick.current, text: sendFailureText(code) });
    }
  }, [applyConvId, applyServer, noteFailure]);

  /** 送出：本機立刻出現「傳送中」。待送出卡片隨這一則送出（送出後從輸入列消失，失敗時由重送沿用） */
  const send = useCallback((input: { text: string; photos: OutgoingPhoto[] }) => {
    const clientId = crypto.randomUUID();
    const card = pendingCard;
    const args = buildSendArgs({ target: targetRef.current, conversationId: convIdRef.current, clientId, text: input.text, card });
    input.photos.forEach(p => previewUrls.current.push(p.previewUrl));
    if (input.photos.length > 0) blobs.current.set(clientId, input.photos.map(p => p.blob));
    const entry = createLocal({
      clientId, side: sideRef.current, text: input.text.trim() || null, card, previews: input.photos.map(p => p.previewUrl),
      args, at: new Date().toISOString(),
    });
    entries.current.set(clientId, entry);
    setLocal(l => [...l, entry]);
    setPendingCard(null);
    if (convIdRef.current) void run(entry);
    else void openingQueue.current.enqueue(() => run(entry));
  }, [pendingCard, run]);

  /** 重送：同一個 client id、同一份參數（冪等） */
  const resend = useCallback((clientId: string) => {
    const entry = entries.current.get(clientId);
    if (!entry) return;
    setLocal(l => restart(l, clientId));
    void run(entry);
  }, [run]);

  const removePendingCard = useCallback(() => setPendingCard(null), []);

  // ───────── 封鎖與隱藏 ─────────
  const setBlock = useCallback(async (on: boolean): Promise<boolean> => {
    const id = convIdRef.current;
    if (!id) return false;
    try {
      const r = on ? await chatBlock(id) : await chatUnblock(id);
      setBlockedByMe(r.blocked_by_me);
      return true;
    } catch (e) {
      noteFailure(e);
      return false;
    }
  }, [noteFailure]);

  const hide = useCallback(async (): Promise<boolean> => {
    const id = convIdRef.current;
    if (!id) return false;
    try {
      await chatHide(id);
      void refreshSummary();
      return true;
    } catch (e) {
      noteFailure(e);
      return false;
    }
  }, [noteFailure, refreshSummary]);

  const messages: DisplayMessage[] = useMemo(() => visibleMessages(server, local), [server, local]);

  return {
    phase, convId, peer, blockedByMe, peerDeleted, messages, hasMore, loadingMore, moreFailed, messagesFailed,
    pendingCard, cardRemovable, incoming, failure,
    send, resend, removePendingCard, loadMore, retryLoad, retryMessages, block: () => setBlock(true), unblock: () => setBlock(false), hide,
  };
}
