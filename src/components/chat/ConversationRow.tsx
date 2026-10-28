import { Link } from 'react-router-dom';
import LetterAvatar from '../LetterAvatar';
import UnreadPill from './UnreadPill';
import { useLongPress } from './useLongPress';
import { listTime, previewSpoken, previewText, rowSpoken } from '../../lib/chat/format';
import { peerView } from '../../lib/chat/nav';
import type { ConversationRow as Row } from '../../lib/chat/types';

interface Props {
  row: Row;
  to: string;
  now: Date;
  /** 長按（或桌機右鍵）；沒給就不啟用（賣家沒有隱藏） */
  onLongPress?: (row: Row) => void;
}

/** 聊聊列表的一列（兩端共用）：頭像、名稱、最後一則摘要、時間、未讀數。整列是一個連結，高度 ≥ 72 */
export default function ConversationRow({ row, to, now, onLongPress }: Props) {
  const peer = peerView(row.counterpart);
  const unread = row.unread_count > 0;
  const time = listTime(row.last_message_at, now);
  const press = useLongPress(() => onLongPress?.(row));
  const handlers = onLongPress ? press : {};
  return (
    <li className="relative after:absolute after:bottom-0 after:left-20 after:right-0 after:border-b-[0.5px] after:border-separator last:after:hidden">
      <Link
        to={to}
        {...handlers}
        aria-label={rowSpoken({ name: peer.name, unread: row.unread_count, last: row.last_message, time, blocked: row.blocked_by_me })}
        style={onLongPress ? { WebkitTouchCallout: 'none' } : undefined}
        className="flex min-h-18 items-center gap-3 px-5 py-3 transition-colors duration-200 active:bg-press active:duration-0"
      >
        <LetterAvatar name={peer.letter} size={48} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-headline font-semibold ${peer.deleted ? 'text-muted' : 'text-ink'}`}>{peer.name}</span>
            {row.blocked_by_me && (
              <span className="shrink-0 rounded-full bg-canvas px-1.5 text-caption2 font-semibold text-muted">已封鎖</span>
            )}
          </span>
          <span className={`block truncate text-subhead ${unread ? 'font-medium text-ink' : 'text-muted'}`}>
            <span className="sr-only">{previewSpoken(row.last_message)}</span>
            <span aria-hidden="true">{previewText(row.last_message)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-footnote text-muted">{time}</span>
          <UnreadPill count={row.unread_count} />
        </span>
      </Link>
    </li>
  );
}
