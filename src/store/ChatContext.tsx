import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from './StoreContext';
import { chatUnreadSummary, subscribeTopic } from '../lib/chat/api';
import { errorCodeOf, isUnavailable } from '../lib/chat/errors';
import { EMPTY_SUMMARY, type UnreadSummary } from '../lib/chat/types';
import type { ChatAvailability } from '../lib/chat/nav';

// 聊聊的全站狀態：資料庫有沒有升級（降級判斷，R-M24）與未讀摘要（買家 tab、桌機連結、賣家底欄與總覽卡的角標數）。
// 更新時機（§6.5）：進站、登入狀態改變、App 回前景、網路恢復、收到 user:<uid> 頻道的事件、對話頁標已讀之後。
// 賣家中心（CH-A2）也讀這裡：摘要一次回買家側與店家側兩組數字。

interface ChatCtx {
  availability: ChatAvailability;
  summary: UnreadSummary;
  /** 每次成功重讀摘要就加 1（數字沒變也算）：列表據此知道「有動靜」，靜默重讀自己 */
  revision: number;
  /** 重讀未讀摘要；同時有多個要求會合併成一次（最後一個要求之後一定會再讀一次） */
  refresh: () => Promise<void>;
  /** 某個聊聊呼叫發現資料庫沒有聊聊函式：全站降級 */
  markUnavailable: () => void;
}

const Ctx = createContext<ChatCtx | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, authReady } = useStore();
  const userId = user?.id ?? null;
  const [availability, setAvailability] = useState<ChatAvailability>('unknown');
  const [summary, setSummary] = useState<UnreadSummary>(EMPTY_SUMMARY);
  const [revision, setRevision] = useState(0);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        try {
          const s = await chatUnreadSummary();
          setAvailability('ok');
          setSummary(s);
          setRevision(n => n + 1);
        } catch (e) {
          if (isUnavailable(e)) {
            setAvailability('unavailable');
            setSummary(EMPTY_SUMMARY);
          } else if (errorCodeOf(e) === 'LOGIN_REQUIRED') {
            // 遊客：函式存在（拿到的是「請先登入」而不是「找不到函式」），聊聊可用，只是沒有未讀
            setAvailability('ok');
            setSummary(EMPTY_SUMMARY);
          }
          // 其他（網路中斷、逾時）：保留目前的數字，下次更新時機再讀
        }
      } while (again.current);
    })().finally(() => { running.current = null; });
    running.current = run;
    return run;
  }, []);

  const markUnavailable = useCallback(() => {
    setAvailability('unavailable');
    setSummary(EMPTY_SUMMARY);
  }, []);

  // 進站與登入狀態改變時讀一次（遊客也讀：用來判斷資料庫有沒有升級）
  useEffect(() => {
    if (!authReady) return;
    void refresh();
  }, [authReady, userId, refresh]);

  // 回前景、網路恢復
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onOnline = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); };
  }, [refresh]);

  // 我的頻道：任何一條對話有新訊息或已讀狀態改變（包含我的另一支裝置）都會通知。確認可用之後才訂閱，舊資料庫不會一直重連
  const live = availability === 'ok' && userId !== null;
  useEffect(() => {
    if (!live || !userId) return;
    return subscribeTopic(`user:${userId}`, 'summary', () => { void refresh(); }, s => { if (s === 'subscribed') void refresh(); });
  }, [live, userId, refresh]);

  const value = useMemo<ChatCtx>(() => ({ availability, summary, revision, refresh, markUnavailable }), [availability, summary, revision, refresh, markUnavailable]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useChat 必須在 ChatProvider 內使用');
  return c;
}
