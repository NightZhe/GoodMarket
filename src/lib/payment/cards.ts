import type { PaymentMethodRow } from './types';

export type CardBrand = PaymentMethodRow['brand'];

/**
 * 由卡號前六碼推卡別（通用的卡組織號段，不是綠界給的）。
 * 4＝Visa；51–55、2221–2720＝Mastercard；3528–3589＝JCB；34、37＝AMEX；62＝銀聯；其他推不出來。
 */
export function brandOfCard6(card6: string): CardBrand {
  if (!/^\d{4,}/.test(card6)) return 'other';
  const n2 = Number(card6.slice(0, 2));
  const n4 = Number(card6.slice(0, 4));
  if (card6.startsWith('4')) return 'visa';
  if ((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) return 'mastercard';
  if (n4 >= 3528 && n4 <= 3589) return 'jcb';
  if (n2 === 34 || n2 === 37) return 'amex';
  if (n2 === 62) return 'unionpay';
  return 'other';
}

/** 卡別以資料庫 view 的 brand 為準；它回 other 時才用前六碼補推 */
export const cardBrandOf = (c: Pick<PaymentMethodRow, 'brand' | 'card6'>): CardBrand =>
  c.brand !== 'other' ? c.brand : brandOfCard6(c.card6);

const LABEL: Record<CardBrand, string> = {
  visa: 'Visa', mastercard: 'Mastercard', jcb: 'JCB', amex: 'AMEX', unionpay: '銀聯', other: '信用卡',
};
export const brandLabel = (b: CardBrand): string => LABEL[b];

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 有效期限：顯示「MM/YY」；有效到該月最後一天，台北時間進入下個月就算過期 */
export function expiryOf(yy: string, mm: string, now: Date = new Date()): { text: string; expired: boolean } {
  const t = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const nowIndex = t.getUTCFullYear() * 12 + t.getUTCMonth();
  const expIndex = (2000 + Number(yy)) * 12 + (Number(mm) - 1);
  return { text: `${mm}/${yy}`, expired: expIndex < nowIndex };
}
