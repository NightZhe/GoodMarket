import { Banknote, Ban, CircleAlert, CircleCheck, Clock, CreditCard, Hourglass, type LucideIcon } from 'lucide-react';

// 付款標籤（設計 3.2）：圖示 12px aria-hidden，文字一律在，不只靠顏色。

export type PayTagKind =
  | 'online' | 'cod' | 'cancelledAuth' | 'unprocessed' | 'cancelled'
  | 'paid' | 'pending' | 'confirming' | 'failed';

const TAGS: Record<PayTagKind, { text: string; tone: string; Icon?: LucideIcon; iconTone?: string }> = {
  online: { text: '線上付款', tone: 'bg-canvas text-ink', Icon: CreditCard },
  cod: { text: '貨到付款', tone: 'bg-canvas text-ink', Icon: Banknote },
  cancelledAuth: { text: '已取消授權', tone: 'bg-canvas text-ink', Icon: Ban },
  unprocessed: { text: '未處理', tone: 'bg-canvas text-ink' },
  cancelled: { text: '已取消', tone: 'bg-canvas text-ink', Icon: Ban },
  paid: { text: '已付款', tone: 'bg-success-soft text-success-text', Icon: CircleCheck },
  pending: { text: '待付款', tone: 'bg-warning-bg text-warning-text', Icon: Clock },
  confirming: { text: '確認中', tone: 'bg-info-bg text-info-text', Icon: Hourglass },
  // 錯誤底色上的字一律 ink（error-text 對 error-bg 只有 4.41:1），錯誤色只給圖示
  failed: { text: '未通過', tone: 'bg-error-bg text-ink', Icon: CircleAlert, iconTone: 'text-error-text' },
};

export function PayTag({ kind }: { kind: PayTagKind }) {
  const { text, tone, Icon, iconTone } = TAGS[kind];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {Icon && <Icon size={12} className={iconTone} aria-hidden="true" />}
      {text}
    </span>
  );
}

/** 「我的訂單」訂單卡標題列右側的狀態標籤（設計 3.2「訂單狀態標籤」） */
export function OrderStateChip({ kind }: { kind: 'pending' | 'confirming' | 'expired' }) {
  if (kind === 'expired') {
    return <span className="inline-flex items-center gap-1 text-sm text-muted"><Ban size={14} aria-hidden="true" />付款逾時，已取消</span>;
  }
  const [Icon, tone, text] = kind === 'pending'
    ? [Clock, 'bg-warning-bg text-warning-text', '待付款'] as const
    : [Hourglass, 'bg-info-bg text-info-text', '付款確認中'] as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-sm font-medium ${tone}`}>
      <Icon size={14} aria-hidden="true" />{text}
    </span>
  );
}
