import { money } from '../format';

// 結帳頁「哪些店怎麼付」的規則（設計 8.1、決策 D24＝A）。純函式，畫面只負責排版。

/** 綠界單筆授權上限：單一商店本單金額（商品＋運費）超過就歸貨到付款（EC/35630） */
export const ONLINE_SHOP_LIMIT = 200_000;

export type PayChoice = { kind: 'cod' } | { kind: 'card'; cardId: string };

export interface PlanShop { shopId: string; /** 商品加運費 */ total: number }

/** 貨到付款的店若是因為「不能線上付款」才歸過來，要在店家區塊底部寫原因 */
export type CodReason = 'not_enrolled' | 'over_limit';

export interface PlannedShop extends PlanShop { reason: CodReason | null }

export interface CheckoutPlan {
  /** 線上付款的店、貨到付款的店；組內維持購物車原本的順序 */
  online: PlannedShop[];
  cod: PlannedShop[];
  onlineTotal: number;
  codTotal: number;
  /** 這次信用卡會被刷幾筆（＝線上付款的店數） */
  onlineCount: number;
  grandTotal: number;
  /** 有沒有任何店「可以」線上付款（不管買家選什麼）：沒有的話付款區塊只剩貨到付款並說明 */
  anyOnlinePayable: boolean;
}

export interface PlanInput {
  shops: PlanShop[];
  choice: PayChoice;
  /** 功能開關 */
  enabled: boolean;
  /** get_shops_online_payable 的結果；查不到的店當作未開通 */
  payable: Record<string, boolean | undefined>;
}

const reasonOf = (s: PlanShop, payable: PlanInput['payable']): CodReason | null =>
  payable[s.shopId] !== true ? 'not_enrolled' : s.total > ONLINE_SHOP_LIMIT ? 'over_limit' : null;

export function planCheckout({ shops, choice, enabled, payable }: PlanInput): CheckoutPlan {
  const planned = shops.map(s => ({ ...s, reason: reasonOf(s, payable) }));
  const wantsOnline = enabled && choice.kind === 'card';
  const online = wantsOnline ? planned.filter(s => s.reason === null) : [];
  // 買家自己選貨到付款（或開關關著）時不是「這家店不行」，不寫原因
  const cod = planned.filter(s => !online.includes(s)).map(s => (wantsOnline ? s : { ...s, reason: null }));
  const sum = (list: PlanShop[]) => list.reduce((n, s) => n + s.total, 0);
  return {
    online, cod,
    onlineTotal: sum(online), codTotal: sum(cod), onlineCount: online.length, grandTotal: sum(shops),
    anyOnlinePayable: enabled && planned.some(s => s.reason === null),
  };
}

/** 貨到付款組裡「不能線上付款」的店底下的原因句（PR-乙 IN-B6；decisions E3＝A）。
 *  平台收款開關關著時逐字維持現在的句子（AC-50）；開著時 not_enrolled 不解釋原因（能不能線上付款取決於店主有沒有撥款帳號，
 *  那是店主的私人狀態），over_limit 不變 */
export function codReasonText(reason: CodReason, platformOn: boolean): string {
  if (reason === 'over_limit') return `這家店的金額超過線上付款的單筆上限（${money(ONLINE_SHOP_LIMIT)}），只能貨到付款。`;
  return platformOn ? '這家店目前只能貨到付款。' : '這家店還沒開通線上付款，只能貨到付款。';
}

/** 底欄按鈕：全貨到付款＝「下訂單」；線上付款寫「現在會被請款的金額」，多家店再加店數 */
export const payButtonLabel = (p: CheckoutPlan): string =>
  p.onlineCount === 0 ? '下訂單' : `付款 ${money(p.onlineTotal)}${p.onlineCount > 1 ? `（${p.onlineCount} 家店）` : ''}`;

interface CardLike { id: string; is_default: boolean; expired: boolean }

/** 預選：預設且未過期的卡；否則貨到付款（沒有卡、預設卡過期、這次沒有店能線上付款） */
export function preselectChoice(cards: CardLike[], anyOnlinePayable: boolean): PayChoice {
  const pick = anyOnlinePayable ? cards.find(c => c.is_default && !c.expired) : undefined;
  return pick ? { kind: 'card', cardId: pick.id } : { kind: 'cod' };
}

/** 重新付款頁的預選：預設且未過期且不是剛失敗的那張 → 第一張可用的 → 都沒有就不預選 */
export function preselectRetryCard(cards: CardLike[], failedCardId: string | null): string | null {
  const usable = cards.filter(c => !c.expired && c.id !== failedCardId);
  return (usable.find(c => c.is_default) ?? usable[0])?.id ?? null;
}
