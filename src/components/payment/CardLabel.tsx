import { CircleAlert, CreditCard } from 'lucide-react';
import { brandLabel, cardBrandOf, expiryOf } from '../../lib/payment/cards';
import type { PaymentMethodRow } from '../../lib/payment/types';

/** 卡片圖示塊：不用品牌商標（授權問題，也看不出卡別），一律線條圖示＋文字卡別；<360px 隱藏，給文字讓位 */
export function CardIcon({ icon: Icon = CreditCard }: { icon?: typeof CreditCard }) {
  return (
    <span aria-hidden="true" className="flex h-9 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-white text-muted max-[359px]:hidden">
      <Icon size={22} />
    </span>
  );
}

/** 「Visa •••• 4242」：••••是裝飾（aria-hidden），讀屏念「Visa 末四碼 4242」 */
export function CardName({ card }: { card: Pick<PaymentMethodRow, 'brand' | 'card6' | 'card4'> }) {
  return (
    <>
      <span className="font-medium">{brandLabel(cardBrandOf(card))}</span>
      <span className="whitespace-nowrap tabular-nums">
        <span aria-hidden="true">•••• </span><span className="sr-only">末四碼 </span>{card.card4}
      </span>
    </>
  );
}

export function DefaultTag() {
  return <span className="inline-flex shrink-0 items-center rounded-sm bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success-text">預設</span>;
}

/**
 * 卡片資訊：圖示塊＋卡名＋「預設」標籤＋有效期限（或已過期原因）。
 * variant row＝S-2 列表（副文 muted）；choice＝結帳／重付 radio 列（選中底色上副文要 ink，muted 對 brand-soft 只有 4.41:1）
 */
export default function CardLabel({ card, variant, note }: { card: PaymentMethodRow; variant: 'row' | 'choice'; note?: string }) {
  const exp = expiryOf(card.exp_year, card.exp_month);
  const expired = card.expired || exp.expired;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <CardIcon />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <CardName card={card} />
          {card.is_default && <DefaultTag />}
        </span>
        {expired ? (
          <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-error-text">
            <CircleAlert size={14} className="shrink-0" aria-hidden="true" />已過期（{exp.text}），不能使用
          </span>
        ) : note ? (
          <span className="mt-0.5 flex items-center gap-1 text-sm text-ink"><CircleAlert size={14} className="shrink-0 text-error-text" aria-hidden="true" />{note}</span>
        ) : (
          <span className={`mt-0.5 block text-sm ${variant === 'choice' ? 'text-ink' : 'text-muted'}`}>有效至 {exp.text}</span>
        )}
      </span>
    </div>
  );
}
