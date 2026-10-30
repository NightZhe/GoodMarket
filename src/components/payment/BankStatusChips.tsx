import { CircleAlert, CircleCheck, Clock, Landmark, type LucideIcon } from 'lucide-react';
import { STATUS_LABEL, type BankStatus } from '../../lib/payment/bankAccount';

// 角色與驗證狀態的 chip：一律圖示＋文字，不只靠顏色。未通過不用 error-text 當字色（壓在 error-bg 上只有 4.41）
const CHIP = 'inline-flex h-6 items-center gap-1 rounded-sm px-2 text-footnote font-medium';
const STATUS: Record<BankStatus, { Icon: LucideIcon; box: string; icon: string }> = {
  verified: { Icon: CircleCheck, box: 'bg-success-soft text-success-text', icon: '' },
  pending: { Icon: Clock, box: 'bg-canvas text-muted', icon: '' },
  rejected: { Icon: CircleAlert, box: 'bg-error-bg text-ink', icon: 'text-error-text' },
};

export function StatusChip({ status }: { status: BankStatus }) {
  const { Icon, box, icon } = STATUS[status];
  return <span className={`${CHIP} ${box}`}><Icon size={14} className={icon} aria-hidden="true" />{STATUS_LABEL[status]}</span>;
}

export function PayoutChip() {
  return <span className={`${CHIP} bg-tab-sel text-brand`}><Landmark size={14} aria-hidden="true" />撥款帳號</span>;
}
