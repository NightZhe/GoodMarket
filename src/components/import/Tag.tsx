import { CircleAlert, Info, TriangleAlert } from 'lucide-react';

export type TagKind = 'error' | 'warn' | 'info';

const STYLE: Record<TagKind, { label: string; cls: string; Icon: typeof Info }> = {
  error: { label: '錯誤', cls: 'border-error-border text-error-text', Icon: CircleAlert },
  warn: { label: '提醒', cls: 'border-warning-border text-warning-text', Icon: TriangleAlert },
  info: { label: '略過', cls: 'border-line text-muted', Icon: Info },
};

/** 圖示＋文字標籤：錯誤／提醒／略過不只靠顏色分辨（F-8.2、AC-76） */
export default function Tag({ kind, label }: { kind: TagKind; label?: string }) {
  const { label: defaultLabel, cls, Icon } = STYLE[kind];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm border bg-white px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon size={12} aria-hidden="true" />
      {label ?? defaultLabel}
    </span>
  );
}
