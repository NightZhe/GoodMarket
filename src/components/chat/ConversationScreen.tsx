import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import Composer, { type ComposerBlock } from './Composer';
import { BlockedBar, OfflineBar, PeerGoneBar, RulesNotice } from './ChatStatusBars';
import { ConversationFailure, MessagesFailed, MessagesSkeleton } from './ChatStates';
import MessageList from './MessageList';
import LetterAvatar from '../LetterAvatar';
import { contextLine, lastCardOf } from '../../lib/chat/context';
import type { DisplayMessage } from '../../lib/chat/outbox';
import type { PeerView } from '../../lib/chat/nav';
import type { Announcement, ConversationPhase, OutgoingPhoto } from '../../lib/chat/useConversation';
import type { ChatCard, ChatSide } from '../../lib/chat/types';

/** 畫面需要的全部資料（由 ConversationView 組出來；測試直接餵這個物件就能渲染每一種狀態） */
export interface ScreenModel {
  side: ChatSide;
  phase: ConversationPhase;
  online: boolean;
  peer: PeerView | null;
  /** 還沒載入完時，導覽列先顯示的名稱（買家端從商店資料取得） */
  fallbackName?: string;
  blockedByMe: boolean;
  peerDeleted: boolean;
  /** 對話已經存在（才有封鎖／隱藏可以操作） */
  hasMenu: boolean;
  messages: DisplayMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  messagesFailed: boolean;
  pendingCard: ChatCard | null;
  cardRemovable: boolean;
  rulesVisible: boolean;
  urls: Record<string, string>;
  signFailed: boolean;
  incoming: Announcement | null;
  failure: Announcement | null;
  unblockBusy: boolean;
  focusToken: number;
  /** 返回的路徑與文字；桌機窗格不需要返回就不給 */
  backTo?: string;
  backLabel?: string;
  /** 失敗頁的出口 */
  listTo: string;
  homeTo: string;
  ordersTo: string;
  desktopHint?: boolean;
  /** 外層容器的高度與樣式（桌機窗格會換成 h-full） */
  className?: string;
}

export interface ScreenHandlers {
  onOpenMenu: () => void;
  onUnblock: () => void;
  onDismissRules: () => void;
  onSend: (input: { text: string; photos: OutgoingPhoto[] }) => void;
  onResend: (clientId: string) => void;
  onRemoveCard: () => void;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  onRetryMessages: () => void;
  onLogin: () => void;
  cardTo: (card: ChatCard) => string;
  cardGone: (card: ChatCard) => boolean;
  onCardGone: (card: ChatCard) => void;
  onBrokenImage: (path: string) => void;
  onOpenImage: (message: DisplayMessage, index: number, trigger: HTMLElement) => void;
}

// 桌機網頁（md 以上）限寬置中，氣泡不會貼在 1280 寬的兩端；賣家桌機窗格自己傳 className
const DEFAULT_ROOT = 'h-[calc(100dvh-env(safe-area-inset-top))] md:mx-auto md:h-[calc(100dvh-env(safe-area-inset-top)-2.75rem)] md:w-full md:max-w-3xl md:border-x-[0.5px] md:border-separator';

/**
 * 對話頁的版面（兩端共用，純畫面）：導覽列 → 狀態列／規則提示 → 訊息區（可捲）→ 輸入列。
 * 骨架是 h-dvh 的 flex 欄，輸入列在正常流裡、不用 position:fixed（iOS 鍵盤開啟時 fixed 元素會跳）。
 * 兩個 live region 一進頁就掛好（要先存在才念得出）：新訊息一句（polite）、送出失敗一句（assertive）
 */
export default function ConversationScreen({ m, h, overlays }: { m: ScreenModel; h: ScreenHandlers; overlays?: ReactNode }) {
  const statusId = useId();
  const ready = m.phase === 'ready';
  const peerName = m.peer?.name ?? m.fallbackName ?? '';
  // 開頁時網路錯誤（offline）：還沒拿到對話，輸入列一律停用；瀏覽器說在線時用「載入中」的樣子，不假稱離線
  const openedOffline = m.phase === 'offline';
  const block: ComposerBlock = m.phase === 'loading' ? 'loading' : !m.online ? 'offline' : openedOffline ? 'loading' : m.peerDeleted ? 'gone' : m.blockedByMe ? 'blocked' : null;
  const emptyText = m.side === 'buyer' ? '還沒有訊息，傳一則打聲招呼吧。' : '還沒有訊息，傳一則訊息給買家吧。';
  const failedPhase = m.phase !== 'loading' && m.phase !== 'ready' && m.phase !== 'offline';
  // 標題下的脈絡列（D10）：已載入訊息裡最近一張卡；還沒載入、或這條對話沒有卡就沒有這一行
  const context = contextLine(lastCardOf(m.messages));

  return (
    <div className={`flex flex-col bg-white ${m.className ?? DEFAULT_ROOT}`}>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{m.incoming?.text ?? ''}</p>
      <p role="alert" className="sr-only">{m.failure?.text ?? ''}</p>

      <header className="material shrink-0 border-b-[0.5px] border-separator">
        <div className="flex h-11 items-center justify-between gap-2 pl-2 pr-1">
          {m.backTo && (
            <Link to={m.backTo} aria-label={`返回${m.backLabel ?? '聊聊'}`} className="-ml-1 flex h-11 shrink-0 items-center pr-3 text-body text-brand transition-opacity duration-200 active:opacity-50 active:duration-0">
              <ChevronLeft size={28} strokeWidth={2.4} aria-hidden="true" />
              {m.backLabel ?? '聊聊'}
            </Link>
          )}
          <PeerTitle peer={m.peer} fallbackName={m.fallbackName} context={context} link={m.side === 'buyer'} />
          {ready && m.hasMenu ? (
            <button
              type="button"
              aria-label="更多選項"
              aria-haspopup="dialog"
              onClick={h.onOpenMenu}
              className="grid size-11 shrink-0 place-items-center text-brand transition-opacity duration-200 active:opacity-50 active:duration-0"
            >
              <Ellipsis size={24} strokeWidth={1.7} aria-hidden="true" />
            </button>
          ) : <span aria-hidden="true" className="size-11 shrink-0" />}
        </div>
      </header>

      {failedPhase ? (
        <ConversationFailure phase={m.phase as Exclude<ConversationPhase, 'loading' | 'ready' | 'offline'>} side={m.side} listTo={m.listTo} homeTo={m.homeTo} ordersTo={m.ordersTo} onRetry={h.onRetryLoad} onLogin={h.onLogin} />
      ) : (
        <>
          {(ready || openedOffline) && (
            !m.online ? <OfflineBar id={statusId} />
            : openedOffline ? null
            : m.peerDeleted ? <PeerGoneBar id={statusId} kind={m.side === 'buyer' ? 'shop' : 'account'} />
            : m.blockedByMe ? <BlockedBar id={statusId} busy={m.unblockBusy} onUnblock={h.onUnblock} />
            : null
          )}
          {ready && m.rulesVisible && <RulesNotice onDismiss={h.onDismissRules} />}

          {m.phase === 'loading' ? <MessagesSkeleton /> : openedOffline && m.online ? (
            <MessagesFailed onRetry={h.onRetryLoad} />
          ) : m.messagesFailed && m.messages.length === 0 ? (
            <MessagesFailed onRetry={h.onRetryMessages} />
          ) : (
            <MessageList
              messages={m.messages} peerName={peerName} urls={m.urls} signFailed={m.signFailed}
              hasMore={m.hasMore} loadingMore={m.loadingMore} moreFailed={m.moreFailed} onLoadMore={h.onLoadMore}
              cardTo={h.cardTo} cardGone={h.cardGone} onCardGone={h.onCardGone} onBrokenImage={h.onBrokenImage}
              onOpenImage={h.onOpenImage} onResend={h.onResend}
              empty={
                <div className="flex flex-col items-center gap-2 text-center">
                  <LetterAvatar name={m.peer?.letter ?? m.fallbackName ?? ''} size={64} />
                  <p className="text-headline font-semibold text-ink">{peerName}</p>
                  <p className="text-subhead text-muted">{emptyText}</p>
                </div>
              }
            />
          )}

          <Composer
            block={block}
            reasonId={(ready || openedOffline) && block !== null && block !== 'loading' ? statusId : undefined}
            pendingCard={m.phase === 'loading' ? null : m.pendingCard}
            cardRemovable={m.cardRemovable}
            onRemoveCard={h.onRemoveCard}
            onSend={h.onSend}
            focusToken={m.focusToken}
            desktopHint={m.desktopHint}
          />
        </>
      )}
      {overlays}
    </div>
  );
}

/** 導覽列中央：頭像＋名稱；有脈絡列時名稱下方多一行小字（同一個 44 高的列裡放得下：20＋16），整組仍是一個連結 */
function PeerTitle({ peer, fallbackName, context, link }: { peer: PeerView | null; fallbackName?: string; context: string | null; link: boolean }) {
  const name = peer?.name ?? fallbackName;
  if (!name) return <span className="flex-1" />;
  const inner = (
    <>
      <LetterAvatar name={peer?.letter ?? fallbackName ?? ''} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className={`truncate text-headline font-semibold leading-5 ${peer?.deleted ? 'text-muted' : 'text-ink'}`}>{name}</span>
        {context && <span className="truncate text-xs leading-4 text-muted">{context}</span>}
      </span>
    </>
  );
  const cls = 'flex min-w-0 max-w-[55vw] flex-1 items-center justify-center gap-2';
  return link && peer?.shopId
    ? <Link to={`/shop/${peer.shopId}`} aria-label={`前往『${name}』的店家頁`} className={`${cls} h-11 transition-opacity duration-200 active:opacity-50 active:duration-0`}>{inner}</Link>
    : <span className={cls}>{inner}</span>;
}
