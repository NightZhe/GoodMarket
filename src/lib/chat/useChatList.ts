import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/StoreContext';
import { useChat } from '../../store/ChatContext';
import { chatList } from './api';
import { isUnavailable, openFailure } from './errors';
import type { ChatSide, ConversationRow, ListCursor } from './types';

export type ListPhase = 'loading' | 'ready' | 'login' | 'unavailable' | 'error';

/**
 * 聊聊列表（買家端 side='buyer'、賣家中心 side='shop'）。
 * 進頁讀第一頁，往下捲載下一頁；摘要更新（收到事件、回前景、對話頁標已讀）時靜默重讀第一頁，列表不閃、不回頂。
 * 已經有資料時重讀失敗就保留畫面（silentFailed）。
 */
export function useChatList(side: ChatSide) {
  const { user, authReady } = useStore();
  const { revision, markUnavailable } = useChat();
  const [phase, setPhase] = useState<ListPhase>('loading');
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [cursor, setCursor] = useState<ListCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [staleFailed, setStaleFailed] = useState(false);
  const loaded = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!authReady) return;
    if (!user) { setPhase('login'); return; }
    let alive = true;
    // 第一次讀才顯示載入中；之後的重讀是靜默的
    if (!loaded.current) setPhase('loading');
    void chatList(side).then(page => {
      if (!alive) return;
      loaded.current = true;
      setRows(page.items);
      setCursor(page.next_cursor);
      setMoreFailed(false);
      setStaleFailed(false);
      setPhase('ready');
    }, (e: unknown) => {
      if (!alive) return;
      const kind = openFailure(e);
      if (kind === 'unavailable') { markUnavailable(); setPhase('unavailable'); return; }
      if (loaded.current) { setStaleFailed(true); return; }
      setPhase(kind === 'login' ? 'login' : 'error');
    });
    return () => { alive = false; };
  }, [authReady, user, side, revision, retry, markUnavailable]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await chatList(side, cursor);
      setRows(r => {
        const seen = new Set(r.map(x => x.conversation_id));
        return [...r, ...page.items.filter(x => !seen.has(x.conversation_id))];
      });
      setCursor(page.next_cursor);
    } catch (e) {
      if (isUnavailable(e)) markUnavailable();
      setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, side, markUnavailable]);

  /** 隱藏成功後把那一列拿掉（不必等重讀） */
  const removeRow = useCallback((conversationId: string) => setRows(r => r.filter(x => x.conversation_id !== conversationId)), []);

  return { phase, rows, hasMore: cursor !== null, loadingMore, moreFailed, staleFailed, loadMore, retry: () => setRetry(n => n + 1), removeRow };
}
