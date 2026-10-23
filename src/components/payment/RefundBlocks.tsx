import type { ReactNode } from 'react';
import { CircleCheck, Hourglass, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { CONTACT_EMAIL } from '../../lib/site';
import { focusRing } from '../import/ui';
import { brandLabel, cardBrandOf } from '../../lib/payment/cards';
import type { Line, SellerBadge, StatusBlock, Tone } from '../../lib/payment/refundView';
import type { PaymentMethodRow } from '../../lib/payment/types';

// 退款設計 3：狀態區塊（買家、賣家各一套版型）與賣家標題列徽章。內容（文字、語意色）由 lib/payment/refundView.ts 決定，這裡只負責畫。
// 狀態只靠文字傳達，圖示一律 aria-hidden；區塊不是 live region（背景改變不朗讀，spec 8.3）。

export type CardInfo = Pick<PaymentMethodRow, 'brand' | 'card6' | 'card4'>;

/** 句子裡的「Visa •••• 4242」：••••是裝飾（aria-hidden），讀屏念「Visa 末四碼 4242」；與 CardName 一樣的字，但在行文中卡別與末四碼之間要有空白 */
export function CardInline({ card }: { card: CardInfo }) {
  return (
    <>
      <span className="font-medium">{brandLabel(cardBrandOf(card))}</span>{' '}
      <span className="whitespace-nowrap tabular-nums"><span aria-hidden="true">•••• </span><span className="sr-only">末四碼 </span>{card.card4}</span>
    </>
  );
}

/** 訂單的卡別資料；get_order_payments 沒給卡別或末四碼時是 null（文字整段改寫成「你付款的信用卡」） */
export const cardOf = (pay: { card_brand: PaymentMethodRow['brand'] | null; card4: string | null } | undefined): CardInfo | null =>
  pay?.card4 ? { brand: pay.card_brand ?? 'other', card6: '', card4: pay.card4 } : null;

const ICON: Record<Tone, LucideIcon> = { info: Hourglass, success: CircleCheck, neutral: Info, warning: TriangleAlert };
const ICON_TONE: Record<Tone, string> = { info: 'text-info-text', success: 'text-success-text', neutral: 'text-muted', warning: 'text-warning-text' };
const BUYER_BG: Record<Tone, string> = { info: 'bg-info-bg', success: 'bg-success-soft', neutral: 'bg-subtle', warning: 'bg-warning-bg' };
const SELLER_BOX: Record<Tone, string> = {
  info: 'border-info/40 bg-info-bg', success: 'border-success/40 bg-success-soft', neutral: 'border-line bg-subtle', warning: 'border-warning-border bg-warning-bg',
};

export function LineView({ line, card }: { line: Line; card: CardInfo | null }) {
  return (
    <>
      {line.map((seg, i) => {
        if (typeof seg === 'string') return seg;
        if ('card' in seg) return card ? <CardInline key={i} card={card} /> : null;
        return (
          <a key={i} href={`mailto:${CONTACT_EMAIL}`} className={`inline-flex min-h-11 items-center break-all underline underline-offset-2 ${focusRing}`}>{CONTACT_EMAIL}</a>
        );
      })}
    </>
  );
}

/**
 * 狀態區塊。買家：商品列下方的整寬色塊（接在 border-t 後）；賣家：圓角框。
 * 第一行是區塊標題，其餘是內文；內文一律 ink（語意色底上 muted 對比不夠）；使用者輸入的文字只當純文字（React 預設 escape）。
 * id＋tabIndex=-1：送出成功後把焦點移到這裡，讀屏念出新狀態
 */
export function StatusBlockView({ block, variant, id, card, children }: {
  block: StatusBlock; variant: 'buyer' | 'seller'; id: string; card: CardInfo | null; children?: ReactNode;
}) {
  const Icon = ICON[block.tone];
  const box = variant === 'buyer'
    ? `border-t border-line ${BUYER_BG[block.tone]} px-4 py-3`
    : `mx-4 mb-3 rounded-md border ${SELLER_BOX[block.tone]} p-3`;
  return (
    <div id={id} tabIndex={-1} className={`flex items-start gap-2 text-sm focus:outline-none ${box}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${ICON_TONE[block.tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1 break-words text-ink">
        <p className="font-medium">{block.title}</p>
        {block.lines.map((line, i) => <p key={i}><LineView line={line} card={card} /></p>)}
        {children}
      </div>
    </div>
  );
}

const BADGE: Record<SellerBadge, { text: string; tone: string; Icon: LucideIcon }> = {
  requested: { text: '買家申請取消', tone: 'bg-warning-bg text-warning-text', Icon: TriangleAlert },
  refunding: { text: '退款處理中', tone: 'bg-info-bg text-info-text', Icon: Hourglass },
  refunded: { text: '已退款', tone: 'bg-success-soft text-success-text', Icon: CircleCheck },
};

/** 賣家訂單卡標題列（text-xs）裡，放在狀態膠囊左邊的徽章 */
export function SellerBadgeView({ kind }: { kind: SellerBadge }) {
  const { text, tone, Icon } = BADGE[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tone}`}>
      <Icon size={12} aria-hidden="true" />{text}
    </span>
  );
}
