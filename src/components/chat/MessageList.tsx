import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, LoaderCircle } from 'lucide-react';
import MessageItem from './MessageItem';
import { groupByDate } from '../../lib/chat/format';
import type { DisplayMessage } from '../../lib/chat/outbox';
import type { ChatCard } from '../../lib/chat/types';
import { pillPress } from '../pillButton';

interface Props {
  messages: DisplayMessage[];
  peerName: string;
  urls: Record<string, string>;
  signFailed: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  onLoadMore: () => void;
  cardTo: (card: ChatCard) => string;
  cardGone: (card: ChatCard) => boolean;
  onCardGone: (card: ChatCard) => void;
  onBrokenImage: (path: string) => void;
  onOpenImage: (message: DisplayMessage, index: number, trigger: HTMLElement) => void;
  onResend: (clientId: string) => void;
  /** 沒有任何訊息時顯示的內容（含待送出卡片時也一樣） */
  empty: ReactNode;
}

/** 離底多遠以內算「在底部」：新訊息直接接上並保持貼底 */
const NEAR_BOTTOM_PX = 120;
/** 捲到離頂多近就載入更早的一頁 */
const NEAR_TOP_PX = 80;

/**
 * 訊息區：按日期分組、貼底、往上捲載入更早（補上高度差，閱讀位置不動）、不在底部時不搶捲動而是浮出「↓ 新訊息」。
 * 所有出現／消失／捲動都是瞬間（設計核心決定 6：高頻操作不做動畫）。
 * 這個列表本身不是 live region（否則每次新增會重念整頁）；新訊息的宣告在頁面另外掛的 live region
 */
export default function MessageList({
  messages, peerName, urls, signFailed, hasMore, loadingMore, moreFailed, onLoadMore, cardTo, cardGone, onCardGone, onBrokenImage,
  onOpenImage, onResend, empty,
}: Props) {
  const scroller = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
  const [showPill, setShowPill] = useState(false);
  const first = messages[0]?.key;
  const last = messages[messages.length - 1];
  const lastKey = last?.key;
  const lastMine = last?.mine ?? false;
  const prev = useRef<{ first?: string; last?: string; height: number }>({ height: 0 });
  const groups = useMemo(() => groupByDate(messages, m => m.at, new Date()), [messages]);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setShowPill(false);
  };

  // 進頁停在最底；之後依「是往上載入更早的」還是「來了新的」分別處理
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const p = prev.current;
    if (p.last === undefined) {
      toBottom();
    } else if (first !== p.first && lastKey === p.last) {
      // 最舊的變了、最新的沒變＝往上載入了更早的：補上增加的高度，讓閱讀位置不動
      el.scrollTop += el.scrollHeight - p.height;
    } else if (lastKey !== p.last) {
      if (atBottom.current || lastMine) toBottom();
      else setShowPill(true);
    }
    prev.current = { first, last: lastKey, height: el.scrollHeight };
  }, [first, lastKey, lastMine, loadingMore]);

  // 內容長高（傳送中變成「無法傳送」多一行、圖片載入完…）時，原本貼在底部的就繼續貼底，不然最新那一行會被擠到畫面外
  const content = useRef<HTMLUListElement>(null);
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const el = scroller.current;
    const list = content.current;
    if (!el || !list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(list);
    return () => ro.disconnect();
  }, [hasMessages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = gap <= NEAR_BOTTOM_PX;
    if (atBottom.current) setShowPill(false);
    if (el.scrollTop <= NEAR_TOP_PX && hasMore && !loadingMore && !moreFailed) onLoadMore();
  };

  // 訊息不足一屏時，捲動事件不會發生；往上沒有東西可捲也要能載入更早的
  useEffect(() => {
    const el = scroller.current;
    if (el && hasMore && !loadingMore && !moreFailed && el.scrollHeight <= el.clientHeight) onLoadMore();
  }, [hasMore, loadingMore, moreFailed, messages.length, onLoadMore]);

  if (messages.length === 0) {
    return <section aria-label="訊息" className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6">{empty}</section>;
  }

  return (
    <section
      ref={scroller}
      aria-label="訊息"
      onScroll={onScroll}
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4"
    >
      <div className="mt-auto" />
      {(hasMore || loadingMore) && (
        <div className="flex min-h-11 items-center justify-center py-2 text-footnote text-muted">
          {moreFailed ? (
            <button type="button" onClick={onLoadMore} className="min-h-11 px-3 font-semibold text-brand">載入更早的訊息失敗，點此重試</button>
          ) : (
            <span role="status" className="flex items-center gap-1.5">
              <LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />載入中
            </span>
          )}
        </div>
      )}
      <ul ref={content} className="pb-3">
        {groups.map(g => (
          <li key={g.key}>
            <p className="my-4 text-center text-footnote font-semibold text-muted">
              <time dateTime={g.items[0].at}>{g.label}</time>
            </p>
            <ul>
              {g.items.map((m, i) => (
                <MessageItem
                  key={m.key}
                  className={i === 0 ? '' : g.items[i - 1].mine === m.mine ? 'mt-1' : 'mt-3'}
                  message={m} peerName={peerName} urls={urls} signFailed={signFailed} cardTo={cardTo} cardGone={cardGone}
                  onCardGone={onCardGone} onBrokenImage={onBrokenImage} onOpenImage={onOpenImage} onResend={onResend}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {showPill && (
        <button
          type="button"
          onClick={toBottom}
          className={`glass sticky bottom-3 ml-auto flex h-11 items-center gap-1 self-end rounded-full px-3.5 text-subhead font-semibold text-brand ${pillPress}`}
        >
          <ArrowDown size={16} strokeWidth={2.4} aria-hidden="true" />新訊息
        </button>
      )}
    </section>
  );
}
