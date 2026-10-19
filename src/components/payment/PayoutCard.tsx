import { Link } from 'react-router-dom';
import { ChevronRight, CircleCheck, Landmark } from 'lucide-react';
import { useMerchantState } from '../../lib/payment/useMerchant';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import type { MerchantState } from '../../lib/payment/merchant';

const CARD: Record<Exclude<MerchantState, 'active'>, { box: string; title: string; text: string; cta: string }> = {
  none: { box: 'border-warning-border bg-warning-bg', title: '你的商店還沒開通線上收款', text: '買家目前只能用貨到付款向你購買。', cta: '前往設定' },
  review: { box: 'border-info/40 bg-info-bg', title: '收款帳戶審核中', text: '審核期間，買家只能用貨到付款。', cta: '查看狀態' },
  rejected: { box: 'border-error-border bg-error-bg', title: '收款帳戶被退回', text: '修正資料後才能開始線上收款。', cta: '查看原因並修正' },
  suspended: { box: 'border-error-border bg-error-bg', title: '收款帳戶已停用', text: '恢復之前，買家只能用貨到付款。', cta: '查看原因' },
};

/**
 * 賣場總覽最上方的收款狀態提示（設計 11.5）。線上付款開關關著、或讀不到狀態時完全不顯示。
 * 內文一律 ink：語意色底上的 error-text 對比只有 4.41:1
 */
export default function PayoutCard() {
  const { enabled } = usePaymentConfig();
  const state = useMerchantState(enabled);
  if (!enabled || state === null) return null;

  if (state === 'active') {
    return (
      <Link to="/seller/payout" className="flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <Landmark size={20} className="shrink-0 text-muted" aria-hidden="true" />
        <span className="flex-1">收款帳戶</span>
        <span className="inline-flex items-center gap-1 text-success-text"><CircleCheck size={14} aria-hidden="true" />可收款</span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
    );
  }
  const c = CARD[state];
  return (
    <Link to="/seller/payout" className={`flex min-h-12 items-start gap-3 rounded-lg border p-4 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${c.box}`}>
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
