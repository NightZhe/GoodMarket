import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle, WifiOff } from 'lucide-react';
import ChatIcon from './ChatIcon';
import ConversationRow from './ConversationRow';
import { CenterState } from './ChatStates';
import { pillButton, pillButtonPrimary } from '../pillButton';
import type { ListPhase } from '../../lib/chat/useChatList';
import type { ChatSide, ConversationRow as Row } from '../../lib/chat/types';

export interface ListModel {
  side: ChatSide;
  phase: ListPhase;
  rows: Row[];
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  /** 已有資料時，重讀失敗：頂端提示＋重試，列表照舊 */
  staleFailed: boolean;
  now: Date;
  rowTo: (row: Row) => string;
}

export interface ListHandlers {
  onRetry: () => void;
  onLoadMore: () => void;
  onLogin: () => void;
  onLongPress?: (row: Row) => void;
}

function Skeleton() {
  return (
    <div role="status" className="px-5">
      <span className="sr-only">載入中</span>
      <div aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex min-h-18 items-center gap-3 py-3">
            <div className="size-12 shrink-0 rounded-full bg-canvas" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 rounded-md bg-canvas" />
              <div className="h-3.5 w-7/12 rounded-md bg-canvas" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 捲到底時載入下一頁 */
function LoadMore({ loading, failed, onLoad }: { loading: boolean; failed: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || loading || failed) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) onLoad(); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, failed, onLoad]);
  return (
    <div ref={ref} className="flex min-h-11 items-center justify-center py-2 text-footnote text-muted">
      {failed
        ? <button type="button" onClick={onLoad} className="min-h-11 px-3 font-semibold text-brand">載入失敗，點此重試</button>
        : <span role="status" className="flex items-center gap-1.5"><LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />載入中</span>}
    </div>
  );
}

/** 聊聊列表的內容（兩端共用，純畫面）：載入中／未登入／降級／錯誤／空／有資料 */
export default function ChatListView({ m, h }: { m: ListModel; h: ListHandlers }) {
  switch (m.phase) {
    case 'loading':
      return <Skeleton />;
    case 'login':
      return (
        <CenterState icon={<ChatIcon size={40} />} title="登入後就能和店家聊聊">
          <button type="button" onClick={h.onLogin} className={pillButtonPrimary}>登入或註冊</button>
        </CenterState>
      );
    case 'unavailable':
      return <CenterState icon={<ChatIcon size={40} />} title="聊聊暫時無法使用，請稍後再試" role="status" />;
    case 'error':
      return (
        <CenterState icon={<WifiOff size={40} aria-hidden="true" />} title="聊聊暫時無法載入" body="請檢查網路後再試一次。" role="alert">
          <button type="button" onClick={h.onRetry} className={pillButton}>重試</button>
        </CenterState>
      );
    case 'ready':
      break;
  }

  if (m.rows.length === 0) {
    return m.side === 'buyer' ? (
      <CenterState icon={<ChatIcon size={40} />} title="還沒有對話。到商品頁按『聊聊』就能問店家。">
        <Link to="/" className={pillButton}>去逛逛</Link>
      </CenterState>
    ) : (
      <CenterState icon={<ChatIcon size={40} />} title="還沒有買家傳訊息。" />
    );
  }

  return (
    <>
      {m.staleFailed && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-warning-bg px-5 py-1 text-footnote text-warning-text">
          <span>聊聊暫時無法更新</span>
          <button type="button" onClick={h.onRetry} className="min-h-11 px-2 font-semibold text-brand">重試</button>
        </div>
      )}
      <ul>
        {m.rows.map(r => <ConversationRow key={r.conversation_id} row={r} to={m.rowTo(r)} now={m.now} onLongPress={h.onLongPress} />)}
      </ul>
      {(m.hasMore || m.loadingMore) && <LoadMore loading={m.loadingMore} failed={m.moreFailed} onLoad={h.onLoadMore} />}
    </>
  );
}
