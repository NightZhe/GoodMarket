import { describe, expect, it } from 'vitest';
import { cartMarks, defaultSelected, cartStockNote, parseCheckedOrder, readPriceCheckState, groupRejections, itemAriaLabel, primaryAction, priceTrend, rejectionNotes, rejectionSentence, shippingAriaText } from './priceCheck';
import type { CheckoutRejection } from '../../types';
import { AccountError, accountErrorText } from './errors';

const price = (productId: string, shopId = 's1', seen = 500, current = 450, variantName = '黑色'): CheckoutRejection =>
  ({ kind: 'price', productId, variantId: 'v1', shopId, title: `商品${productId}`, variantName, seenPrice: seen, currentPrice: current });
const stock = (productId: string, shopId = 's1', qty = 3, left = 1, variantName = '黑色'): CheckoutRejection =>
  ({ kind: 'stock', productId, variantId: 'v1', shopId, title: `商品${productId}`, variantName, qty, stock: left });
const ship = (shopId: string, seen = 60, current = 0): CheckoutRejection =>
  ({ kind: 'shipping', shopId, shopName: `店${shopId}`, seenFee: seen, currentFee: current });

const sentence = (changes: CheckoutRejection[]) => rejectionSentence(changes).join('');

describe('失敗畫面說明句（design.md 第 7 節）', () => {
  it('只有價格 1 件', () => {
    expect(sentence([price('a')])).toBe('你結帳時有 1 件商品價格變動，這次沒有成立任何訂單。');
  });
  it('只有價格 3 件', () => {
    expect(sentence([price('a'), price('b'), price('c')])).toBe('你結帳時有 3 件商品價格變動，這次沒有成立任何訂單。');
  });
  it('只有庫存不足（已售完也算庫存不足）', () => {
    expect(sentence([stock('a'), stock('b', 's1', 1, 0)])).toBe('你結帳時有 2 件商品庫存不足，這次沒有成立任何訂單。');
  });
  it('只有運費', () => {
    expect(sentence([ship('s1')])).toBe('你結帳時有 1 家商店的運費變動，這次沒有成立任何訂單。');
  });
  it('同一件價格＋庫存：兩個片段各算一次', () => {
    expect(sentence([price('a'), stock('a')])).toBe('你結帳時有 1 件商品價格變動、1 件商品庫存不足，這次沒有成立任何訂單。');
  });
  it('三類同時：片段依價格、庫存、運費排序，與回傳順序無關', () => {
    const changes = [stock('q'), price('p'), price('r', 's2'), ship('s2')];
    expect(sentence(changes)).toBe('你結帳時有 2 件商品價格變動、1 件商品庫存不足、1 家商店的運費變動，這次沒有成立任何訂單。');
  });
  it('片段只在標點後切開', () => {
    expect(rejectionSentence([price('a'), stock('b'), ship('s1')])).toEqual([
      '你結帳時有 1 件商品價格變動、', '1 件商品庫存不足、', '1 家商店的運費變動，', '這次沒有成立任何訂單。',
    ]);
  });
});

describe('失敗畫面補句', () => {
  it('直接購買、一家店：沒有補句', () => {
    expect(rejectionNotes({ shopCount: 1, fromCart: false })).toEqual([]);
  });
  it('一次送出含兩家以上商店：補「其他商店也沒有下單」', () => {
    expect(rejectionNotes({ shopCount: 2, fromCart: false })).toEqual(['同一次結帳的其他商店商品也沒有下單。']);
  });
  it('購物車來的：補「購物車裡的商品都還在」，排在多店補句之後', () => {
    expect(rejectionNotes({ shopCount: 1, fromCart: true })).toEqual(['購物車裡的商品都還在，數量沒有變。']);
    expect(rejectionNotes({ shopCount: 3, fromCart: true })).toEqual(['同一次結帳的其他商店商品也沒有下單。', '購物車裡的商品都還在，數量沒有變。']);
  });
});

describe('問題清單：店名 → 品項 → 運費列', () => {
  it('同一件價格＋庫存併成一列，價格在前', () => {
    const [shop] = groupRejections([price('a'), stock('a')], ['s1']);
    expect(shop.items).toHaveLength(1);
    expect(shop.items[0]).toMatchObject({ productId: 'a', price: { seen: 500, current: 450 }, stock: { qty: 3, left: 1 } });
  });
  it('店依送出順序排（含只有運費變動的店），店內品項依回傳順序；沒有問題的店不列', () => {
    // 送出順序：s3（沒問題）、s2、s1；伺服器回傳商品在前、運費在後
    const groups = groupRejections([price('x', 's1'), stock('y', 's2'), price('z', 's1'), ship('s1')], ['s3', 's2', 's1']);
    expect(groups.map(g => g.shopId)).toEqual(['s2', 's1']);
    expect(groups[1].items.map(i => i.productId)).toEqual(['x', 'z']);
    expect(groups[1].shipping).toEqual({ seen: 60, current: 0 });
    expect(groups[0].shipping).toBeNull();
  });
  it('只有運費變動的店：沒有品項列，店名取自回傳', () => {
    expect(groupRejections([ship('s9', 0, 60)], ['s9'])).toEqual([
      { shopId: 's9', shopName: '店s9', items: [], shipping: { seen: 0, current: 60 } },
    ]);
  });
  it('送出順序裡沒有的店排在最後（防呆，不丟掉問題）', () => {
    expect(groupRejections([price('a', 'sx'), price('b', 's1')], ['s1']).map(g => g.shopId)).toEqual(['s1', 'sx']);
  });
});

describe('讀屏朗讀字串（design.md 第 8 節，AC-48）', () => {
  it('價格列：品名、規格、原本／現在用「元」、降價、查看商品頁', () => {
    const [{ items: [item] }] = groupRejections([price('a')], ['s1']);
    expect(itemAriaLabel(item)).toBe('商品a，規格：黑色，價格原本 500 元，現在 450 元，降價，查看商品頁');
  });
  it('漲價、千分位', () => {
    const [{ items: [item] }] = groupRejections([price('a', 's1', 1500, 1699)], ['s1']);
    expect(itemAriaLabel(item)).toBe('商品a，規格：黑色，價格原本 1,500 元，現在 1,699 元，漲價，查看商品頁');
  });
  it('規格名空字串時省略規格', () => {
    const [{ items: [item] }] = groupRejections([stock('a', 's1', 3, 1, '')], ['s1']);
    expect(itemAriaLabel(item)).toBe('商品a，你要買 3 件，只剩 1 件，查看商品頁');
  });
  it('已售完', () => {
    const [{ items: [item] }] = groupRejections([stock('a', 's1', 1, 0)], ['s1']);
    expect(itemAriaLabel(item)).toBe('商品a，規格：黑色，已售完，查看商品頁');
  });
  it('同一件兩種問題：價格在前、庫存在後', () => {
    const [{ items: [item] }] = groupRejections([price('a'), stock('a')], ['s1']);
    expect(itemAriaLabel(item)).toBe('商品a，規格：黑色，價格原本 500 元，現在 450 元，降價，你要買 3 件，只剩 1 件，查看商品頁');
  });
  it('運費列', () => {
    expect(shippingAriaText('小店', { seen: 60, current: 0 })).toBe('小店，運費原本 60 元，現在 0 元');
  });
  it('漲跌只看數字方向', () => {
    expect(priceTrend({ seen: 500, current: 450 })).toBe('降價');
    expect(priceTrend({ seen: 450, current: 500 })).toBe('漲價');
  });
});

describe('主要按鈕（D-7a＝D）', () => {
  it('直接購買：回第一件有問題的商品頁', () => {
    expect(primaryAction([ship('s1'), price('b')], { fromCart: false, submittedProductIds: ['b'], submittedKeys: ['b|v1'] }))
      .toEqual({ label: '回商品頁重新購買', to: '/product/b' });
  });
  it('直接購買、只有運費變動：回這次買的那件商品頁', () => {
    expect(primaryAction([ship('s1')], { fromCart: false, submittedProductIds: ['p1'], submittedKeys: ['p1|v1'] }))
      .toEqual({ label: '回商品頁重新購買', to: '/product/p1' });
  });
  it('購物車：回購物車，帶全部問題', () => {
    const changes = [price('a'), ship('s1')];
    expect(primaryAction(changes, { fromCart: true, submittedProductIds: ['a'], submittedKeys: ['a|v1', 'b|v1'] }))
      .toEqual({ label: '回購物車重新結帳', to: '/cart', state: { priceCheck: { changes, submitted: ['a|v1', 'b|v1'] } } });
  });
});

describe('解析下單回傳（place_checked_order）', () => {
  it('成立：回訂單', () => {
    expect(parseCheckedOrder({ outcome: 'ok', orders: [{ id: 'o1' }] })).toEqual({ outcome: 'ok', orders: [{ id: 'o1' }] });
  });
  it('被擋：回問題清單', () => {
    const changes = [price('a'), stock('b'), ship('s1')];
    expect(parseCheckedOrder({ outcome: 'rejected', changes })).toEqual({ outcome: 'rejected', changes });
  });
  it('被擋卻沒有任何問題：當成其他錯誤（結帳頁內「下單失敗，請再試一次」），不顯示空的失敗畫面', () => {
    const run = () => parseCheckedOrder({ outcome: 'rejected', changes: [] });
    expect(run).toThrow(AccountError);
    try { run(); } catch (e) { expect(accountErrorText(e, '下單失敗，請再試一次')).toBe('下單失敗，請再試一次'); }
  });
  it('看不懂的回傳一律丟錯，不當成成立', () => {
    expect(() => parseCheckedOrder(null)).toThrow(AccountError);
    expect(() => parseCheckedOrder({ outcome: 'maybe' })).toThrow(AccountError);
    expect(() => parseCheckedOrder({ outcome: 'ok' })).toThrow(AccountError);
  });
  it('格式不對的單筆問題丟掉，其餘照列', () => {
    const bad = { kind: 'price', productId: 'z', seenPrice: '500' };
    expect(parseCheckedOrder({ outcome: 'rejected', changes: [bad, price('a')] })).toEqual({ outcome: 'rejected', changes: [price('a')] });
  });
});

describe('購物車：從失敗畫面帶回來的問題清單', () => {
  it('讀得出 state 裡的問題清單；其他來源（一般進頁、格式不對）回 null', () => {
    const changes = [price('a')];
    expect(readPriceCheckState({ priceCheck: { changes, submitted: ['a|v1'] } })).toEqual({ changes, submitted: ['a|v1'] });
    expect(readPriceCheckState(null)).toBeNull();
    expect(readPriceCheckState({ items: [] })).toBeNull();
    expect(readPriceCheckState({ priceCheck: { changes: [], submitted: ['a|v1'] } })).toBeNull();
    expect(readPriceCheckState({ priceCheck: { changes: 'x', submitted: ['a|v1'] } })).toBeNull();
    expect(readPriceCheckState({ priceCheck: { changes } })).toBeNull();
  });
  it('依品項與商店建標示：價格文字、運費文字（design.md 第 7 節）', () => {
    const marks = cartMarks([price('a', 's1', 1500, 1450), stock('b'), ship('s2', 60, 0)]);
    expect(marks.items.get('a|v1')?.price).toBe('價格已變動：原本 $1,500，現在 $1,450');
    expect(marks.items.get('b|v1')?.price).toBeNull();
    expect(marks.items.get('b|v1')?.stock).toBe(true);
    expect(marks.shops.get('s2')).toBe('這家店的運費已變動：原本 $60，現在 $0');
    expect(marks.shops.get('s1')).toBeUndefined();
  });
});

describe('購物車「只剩 N 件，請調整數量」的顯示條件', () => {
  it('被標庫存不足、數量仍超過目前庫存：顯示（N＝重讀後的目前庫存）', () => {
    expect(cartStockNote(true, 3, 1)).toBe('只剩 1 件，請調整數量');
  });
  it('數量改到 N 件以內：隱藏', () => {
    expect(cartStockNote(true, 1, 1)).toBeNull();
    expect(cartStockNote(true, 2, 5)).toBeNull();
  });
  it('已售完：不顯示（沿用現有「此規格已售完」，不重複）', () => {
    expect(cartStockNote(true, 1, 0)).toBeNull();
  });
  it('沒被標庫存不足：不顯示', () => {
    expect(cartStockNote(false, 3, 1)).toBeNull();
  });
});

describe('購物車的預設勾選', () => {
  const keys = ['bottle|v1', 'coaster|v1', 'towel|v1'];
  it('一般進購物車：全部勾選（既有行為）', () => {
    expect(defaultSelected(keys, null)).toEqual(keys);
  });
  it('從失敗畫面回來：只勾這次送出結帳的品項，原本沒勾的維持沒勾（B-1）', () => {
    expect(defaultSelected(keys, { changes: [price('bottle')], submitted: ['bottle|v1', 'coaster|v1'] })).toEqual(['bottle|v1', 'coaster|v1']);
  });
  it('送出的品項已不在購物車：不會憑空多勾', () => {
    expect(defaultSelected(keys, { changes: [price('x')], submitted: ['x|v1'] })).toEqual([]);
  });
});
