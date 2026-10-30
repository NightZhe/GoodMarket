import { CircleAlert, CircleCheck, Clock, type LucideIcon } from 'lucide-react';
import { PAYOUT_BADGE_TEXT, type PayoutState } from '../../lib/payment/bankAccount';

// 撥款帳號狀態的徽章（賣家中心側欄、賣場總覽入口列）：圖示＋文字，不只靠顏色。白底上的色都過 4.5:1。
const BADGE: Record<PayoutState, { Icon: LucideIcon; tone: string }> = {
  none: { Icon: CircleAlert, tone: 'text-warning-text' },
  pending: { Icon: Clock, tone: 'text-muted' },
  verified: { Icon: CircleCheck, tone: 'text-success-text' },
  rejected: { Icon: CircleAlert, tone: 'text-error-text' },
};

export default function PayoutBadge({ state, className = '' }: { state: PayoutState; className?: string }) {
  const { Icon, tone } = BADGE[state];
  return <span className={`inline-flex items-center gap-1 text-sm ${tone} ${className}`}><Icon size={14} aria-hidden="true" />{PAYOUT_BADGE_TEXT[state]}</span>;
}
