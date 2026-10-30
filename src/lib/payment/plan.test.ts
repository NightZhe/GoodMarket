import { describe, expect, it } from 'vitest';
import { ONLINE_SHOP_LIMIT, payButtonLabel, planCheckout, preselectChoice, preselectRetryCard, type PlanShop, codReasonText } from './plan';

const A: PlanShop = { shopId: 'A', total: 1010 };
const B: PlanShop = { shopId: 'B', total: 480 };
const C: PlanShop = { shopId: 'C', total: 199 };
const ALL_OK = { A: true, B: true, C: true };
const CARD = { kind: 'card', cardId: 'c1' } as const;

describe('planCheckout：店家依付款方式分組與小計', () => {
  it('選卡且兩家店都開通：全部歸線上付款，小計是兩家相加', () => {
    const p = planCheckout({ shops: [A, B], choice: CARD, enabled: true, payable: ALL_OK });
    expect(p.online.map(s => s.shopId)).toEqual(['A', 'B']);
    expect(p.cod).toEqual([]);
    expect(p.onlineTotal).toBe(1490);
    expect(p.codTotal).toBe(0);
    expect(p.onlineCount).toBe(2);
    expect(p.grandTotal).toBe(1490);
  });

  it('混合：未開通的店歸貨到付款並標原因，兩組各有小計', () => {
    const p = planCheckout({ shops: [A, B, C], choice: CARD, enabled: true, payable: { A: true, B: true, C: false } });
    expect(p.online.map(s => s.shopId)).toEqual(['A', 'B']);
    expect(p.cod.map(s => [s.shopId, s.reason])).toEqual([['C', 'not_enrolled']]);
    expect(p.onlineTotal).toBe(1490);
    expect(p.codTotal).toBe(199);
    expect(p.grandTotal).toBe(1689);
  });

  it('組內順序維持購物車原本的順序，即使中間的店被移去貨到付款', () => {
    const p = planCheckout({ shops: [A, C, B], choice: CARD, enabled: true, payable: { A: true, B: true, C: false } });
    expect(p.online.map(s => s.shopId)).toEqual(['A', 'B']);
  });

  it('買家選貨到付款：全部歸貨到付款，沒有原因行', () => {
    const p = planCheckout({ shops: [A, B], choice: { kind: 'cod' }, enabled: true, payable: ALL_OK });
    expect(p.online).toEqual([]);
    expect(p.cod.map(s => s.reason)).toEqual([null, null]);
    expect(p.codTotal).toBe(1490);
  });

  it('功能開關關閉：就算選了卡也全部貨到付款', () => {
    const p = planCheckout({ shops: [A], choice: CARD, enabled: false, payable: ALL_OK });
    expect(p.online).toEqual([]);
    expect(p.cod).toHaveLength(1);
  });

  it('單店剛好 20 萬仍可線上付款；超過 1 元就歸貨到付款並標超限', () => {
    const edge = planCheckout({ shops: [{ shopId: 'A', total: ONLINE_SHOP_LIMIT }], choice: CARD, enabled: true, payable: ALL_OK });
    expect(edge.online).toHaveLength(1);
    const over = planCheckout({ shops: [{ shopId: 'A', total: ONLINE_SHOP_LIMIT + 1 }, B], choice: CARD, enabled: true, payable: ALL_OK });
    expect(over.cod.map(s => [s.shopId, s.reason])).toEqual([['A', 'over_limit']]);
    expect(over.online.map(s => s.shopId)).toEqual(['B']);
  });

  it('又未開通又超限：原因以未開通為準', () => {
    const p = planCheckout({ shops: [{ shopId: 'A', total: 300000 }], choice: CARD, enabled: true, payable: { A: false } });
    expect(p.cod[0].reason).toBe('not_enrolled');
  });

  it('查不到這家店的開通狀態：當成未開通，不送去線上付款', () => {
    const p = planCheckout({ shops: [A], choice: CARD, enabled: true, payable: {} });
    expect(p.online).toEqual([]);
    expect(p.cod[0].reason).toBe('not_enrolled');
  });

  it('anyOnlinePayable：與買家選什麼無關，只看有沒有任何店能線上付款', () => {
    const none = planCheckout({ shops: [A, B], choice: { kind: 'cod' }, enabled: true, payable: { A: false, B: false } });
    expect(none.anyOnlinePayable).toBe(false);
    const some = planCheckout({ shops: [A, B], choice: { kind: 'cod' }, enabled: true, payable: { A: false, B: true } });
    expect(some.anyOnlinePayable).toBe(true);
    const overOnly = planCheckout({ shops: [{ shopId: 'A', total: 250000 }], choice: CARD, enabled: true, payable: { A: true } });
    expect(overOnly.anyOnlinePayable).toBe(false);
  });
});

describe('payButtonLabel：底欄按鈕文案', () => {
  const plan = (shops: PlanShop[], payable: Record<string, boolean>, card = true) =>
    planCheckout({ shops, choice: card ? CARD : { kind: 'cod' }, enabled: true, payable });
  it('全貨到付款是「下訂單」', () => {
    expect(payButtonLabel(plan([A], ALL_OK, false))).toBe('下訂單');
  });
  it('線上 1 家店：付款 $X，不寫店數', () => {
    expect(payButtonLabel(plan([A], ALL_OK))).toBe('付款 $1,010');
  });
  it('線上 N 家店：付款 $X（N 家店），金額不含貨到付款', () => {
    expect(payButtonLabel(plan([A, B, C], { A: true, B: true, C: false }))).toBe('付款 $1,490（2 家店）');
  });
});

describe('preselectChoice：預選', () => {
  const card = (id: string, o: Partial<{ is_default: boolean; expired: boolean }> = {}) => ({ id, is_default: false, expired: false, ...o });
  it('預設且未過期的卡優先', () => {
    expect(preselectChoice([card('a'), card('b', { is_default: true })], true)).toEqual({ kind: 'card', cardId: 'b' });
  });
  it('預設卡過期：改選貨到付款（不替買家挑別張）', () => {
    expect(preselectChoice([card('a'), card('b', { is_default: true, expired: true })], true)).toEqual({ kind: 'cod' });
  });
  it('沒有卡、或這次沒有任何店能線上付款：貨到付款', () => {
    expect(preselectChoice([], true)).toEqual({ kind: 'cod' });
    expect(preselectChoice([card('a', { is_default: true })], false)).toEqual({ kind: 'cod' });
  });
});

describe('preselectRetryCard：重新付款頁的預選', () => {
  const card = (id: string, o: Partial<{ is_default: boolean; expired: boolean }> = {}) => ({ id, is_default: false, expired: false, ...o });
  it('剛失敗的那張不預選：改選預設的別張，沒有預設就選第一張可用的', () => {
    expect(preselectRetryCard([card('a', { is_default: true }), card('b')], 'a')).toBe('b');
    expect(preselectRetryCard([card('a'), card('b'), card('c', { is_default: true })], 'c')).toBe('a');
  });
  it('過期的卡不選；都沒有可用的就不預選', () => {
    expect(preselectRetryCard([card('a', { expired: true })], null)).toBeNull();
    expect(preselectRetryCard([card('a')], 'a')).toBeNull();
  });
  it('系統問題（沒有失敗的卡）時預選同一張預設卡', () => {
    expect(preselectRetryCard([card('a'), card('b', { is_default: true })], null)).toBe('b');
  });
});

describe('codReasonText：貨到付款組的原因句依平台收款開關切換（PR-乙 IN-B6、E3＝A）', () => {
  it('開關關：逐字維持現在的句子', () => {
    expect(codReasonText('not_enrolled', false)).toBe('這家店還沒開通線上付款，只能貨到付款。');
    expect(codReasonText('over_limit', false)).toBe('這家店的金額超過線上付款的單筆上限（$200,000），只能貨到付款。');
  });
  it('開關開：not_enrolled 改成 E3 句（不洩漏店主有沒有綁帳號）；over_limit 不變', () => {
    expect(codReasonText('not_enrolled', true)).toBe('這家店目前只能貨到付款。');
    expect(codReasonText('over_limit', true)).toBe('這家店的金額超過線上付款的單筆上限（$200,000），只能貨到付款。');
  });
  it('開關開的句子不提「開通」「特約商店」', () => {
    expect(codReasonText('not_enrolled', true)).not.toMatch(/開通|特約商店/);
  });
});
