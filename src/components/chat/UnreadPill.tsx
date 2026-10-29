import { formatUnread } from '../../lib/chat/unread';

/** 列表每一列的未讀訊息數：紅底白字膠囊，靜態排版（不是 CountBadge 那種絕對定位）。0 不顯示 */
export default function UnreadPill({ count }: { count: number }) {
  const text = formatUnread(count);
  if (!text) return null;
  return (
    <span aria-hidden="true" className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-badge px-1.5 text-[12px] font-semibold leading-5 text-white">
      {text}
    </span>
  );
}
