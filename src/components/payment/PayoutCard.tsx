import { Link } from 'react-router-dom';
import { ChevronRight, Landmark } from 'lucide-react';
import PayoutBadge from './PayoutBadge';
import { usePayoutState } from '../../lib/payment/useBankAccounts';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import type { PayoutState } from '../../lib/payment/bankAccount';

const CARD: Record<'none' | 'rejected', { box: string; title: string; text: string; cta: string }> = {
  none: { box: 'border-warning-border bg-warning-bg', title: '還沒有銀行帳號', text: '新增後，之後撥款會匯到這裡。', cta: '前往新增' },
  rejected: { box: 'border-error-border bg-error-bg', title: '銀行帳號未通過驗證', text: '請新增正確的銀行帳號。', cta: '前往處理' },
};

const TO = '/seller/payout';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/**
 * 賣場總覽最上方的撥款帳號狀態提示（設計 8）。線上付款開關關著、或讀不到狀態（含資料庫未升級）時完全不顯示。
 * 內文一律 ink：語意色底上的 error-text 對比只有 4.41:1
 */
export default function PayoutCard() {
  const { enabled } = usePaymentConfig();
  const state = usePayoutState(enabled);
  if (!enabled || state === null) return null;
  return <PayoutCardView state={state} />;
}

export function PayoutCardView({ state }: { state: PayoutState }) {
  if (state === 'pending' || state === 'verified') {
    return (
      <Link to={TO} className={`flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm ${FOCUS}`}>
        <Landmark size={20} className="shrink-0 text-muted" aria-hidden="true" />
        <span className="flex-1">銀行帳號</span>
        <PayoutBadge state={state} />
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
    );
  }
  const c = CARD[state];
  return (
    <Link to={TO} className={`flex min-h-12 items-start gap-3 rounded-lg border p-4 text-ink ${FOCUS} ${c.box}`}>
      <Landmark size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{c.title}</span>
        <span className="mt-0.5 block text-sm">{c.text}</span>
        <span className="mt-1 inline-block text-sm underline underline-offset-2">{c.cta}</span>
      </span>
      <ChevronRight size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
    </Link>
  );
}
