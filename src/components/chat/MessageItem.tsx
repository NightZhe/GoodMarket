import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import MessageCard from './MessageCard';
import MessageImages from './MessageImages';
import { sendFailureText } from '../../lib/chat/errors';
import { clockTime } from '../../lib/chat/format';
import type { DisplayMessage } from '../../lib/chat/outbox';
import type { ChatCard } from '../../lib/chat/types';

interface Props {
  message: DisplayMessage;
  /** 與上一則的間距（同一邊連續 4、換邊 12） */
  className?: string;
  /** 對方的名稱（朗讀用） */
  peerName: string;
  urls: Record<string, string>;
  signFailed: boolean;
  cardTo: (card: ChatCard) => string;
  cardGone: (card: ChatCard) => boolean;
  onCardGone: (card: ChatCard) => void;
  onBrokenImage: (path: string) => void;
  onOpenImage: (message: DisplayMessage, index: number, trigger: HTMLElement) => void;
  onResend: (clientId: string) => void;
}

const STATE_WORD = { sent: '已送出', sending: '傳送中', failed: '無法傳送' } as const;

/** 朗讀前綴（設計 9.2）：「好物小舖，19:50：」「你，19:54，已送出：」。可見的時間欄 aria-hidden，避免念兩次 */
export function spokenPrefix(m: DisplayMessage, peerName: string): string {
  const time = clockTime(m.at);
  return m.mine ? `你，${time}，${STATE_WORD[m.state]}：` : `${peerName}，${time}：`;
}

/**
 * 一則訊息（兩端共用）：縱向堆疊「卡片 → 圖片 → 文字氣泡」，時間與送出狀態放在最後一個元素的外側下緣。
 * 對方靠左灰底、自己靠右淡橘底（ink 黑字，對比 18+）；失敗的訊息把「無法傳送／重送」放在氣泡下方整行（白底上的紅字才過 AA）。
 * 氣泡不是連結也不是按鈕，所以文字可以選取拷貝（全站 a／button 是 user-select:none）
 */
export default function MessageItem({
  message: m, className = '', peerName, urls, signFailed, cardTo, cardGone, onCardGone, onBrokenImage, onOpenImage, onResend,
}: Props) {
  const mine = m.mine;
  const meta = (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-1 pb-0.5 text-caption2 text-muted">
      {m.state === 'sending' && <><LoaderCircle size={12} className="motion-safe:animate-spin" />傳送中</>}
      {m.state === 'sent' && mine && <><Check size={12} strokeWidth={2.4} />{clockTime(m.at)}</>}
      {m.state === 'failed' && clockTime(m.at)}
      {!mine && clockTime(m.at)}
    </span>
  );
  const withMeta = (node: React.ReactNode) => (
    <div className={`flex w-full items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>{node}{meta}</div>
  );

  const hasText = Boolean(m.text);
  const hasPhotos = m.photos.length > 0;

  return (
    <li className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'} ${className}`}>
      <span className="sr-only">{spokenPrefix(m, peerName)}</span>
      {m.card && (
        <div className="w-[min(78%,18rem)]">
          <MessageCard card={m.card} gone={cardGone(m.card)} to={cardTo(m.card)} onGone={() => onCardGone(m.card as ChatCard)} />
        </div>
      )}
      {hasPhotos && (
        <MessageImages
          paths={m.photos} local={m.photosAreLocal} urls={urls} signFailed={signFailed}
          onBroken={onBrokenImage} onOpen={(i, el) => onOpenImage(m, i, el)}
        />
      )}
      {hasText && withMeta(
        <p className={`min-w-0 max-w-[78%] whitespace-pre-wrap break-words rounded-story px-3.5 py-2 text-body text-ink ${mine ? 'rounded-br-[6px] bg-tab-sel' : 'rounded-bl-[6px] bg-canvas'}`}>
          {m.text}
        </p>,
      )}
      {!hasText && (m.card || hasPhotos) && (
        <div className={`flex ${mine ? 'justify-end' : ''}`}>{meta}</div>
      )}
      {m.state === 'failed' && (
        <div className="flex flex-wrap items-center justify-end gap-x-1 text-footnote">
          <CircleAlert size={14} className="shrink-0 text-error-text" aria-hidden="true" />
          <span className="font-semibold text-error-text">{sendFailureText(m.failure)}</span>
          <button
            type="button"
            onClick={() => onResend(m.clientId)}
            className="min-h-11 px-2 font-semibold text-brand transition-opacity duration-200 active:opacity-50 active:duration-0"
          >
            重送
          </button>
        </div>
      )}
    </li>
  );
}
