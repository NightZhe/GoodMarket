import { describe, expect, it } from 'vitest';
import { cardPrice, cardSpoken, cardTargetGone, orderStatusLabel, pendingCardSpoken, pendingCardKicker } from './cards';
import type { ChatCard } from './types';

const product: ChatCard = { type: 'product', id: 'p1', title: '【Jy】Switch 任天堂 NS 咚奇剛', image: '', price: 1000 };
const order: ChatCard = { type: 'order', id: 'o1', order_no: '261028SRPA9T6C', title: 'Switch 任天堂 NS 寶可夢', image: '', item_count: 2, total: 1537, status: 'to_ship' };

describe('卡片文字（設計 9.2、§10.3）', () => {
  it('商品卡朗讀：種類、名稱、價格', () => {
    expect(cardSpoken(product, false)).toBe('商品卡，【Jy】Switch 任天堂 NS 咚奇剛，1000 元');
  });
  it('商品已下架時，朗讀加「商品已下架」', () => {
    expect(cardSpoken(product, true)).toBe('商品卡，【Jy】Switch 任天堂 NS 咚奇剛，1000 元，商品已下架');
  });
  it('價格是快照；沒有價格時不念價格', () => {
    expect(cardPrice({ ...product, price: null } as ChatCard)).toBeNull();
    expect(cardSpoken({ ...product, price: null } as ChatCard, false)).toBe('商品卡，【Jy】Switch 任天堂 NS 咚奇剛');
  });
  it('訂單卡朗讀：編號、品名與件數、金額、「送出時」狀態', () => {
    expect(cardSpoken(order, false)).toBe('訂單卡，訂單 261028SRPA9T6C，Switch 任天堂 NS 寶可夢等 2 件，訂單金額 1537 元，送出時狀態待出貨');
  });
  it('訂單只有 1 件不寫「等」；找不到訂單時加「找不到訂單」', () => {
    expect(cardSpoken({ ...order, item_count: 1 } as ChatCard, false)).toContain('Switch 任天堂 NS 寶可夢，1 件');
    expect(cardSpoken(order, true)).toMatch(/找不到訂單$/);
  });
  it('訂單狀態中文；不認得的狀態照原字', () => {
    expect(orderStatusLabel('to_ship')).toBe('待出貨');
    expect(orderStatusLabel('shipping')).toBe('運送中');
    expect(orderStatusLabel('completed')).toBe('已完成');
    expect(orderStatusLabel('cancelled')).toBe('已取消');
    expect(orderStatusLabel('weird')).toBe('weird');
  });
});

describe('目標還在不在（R-M7：點卡片時才判斷，快照不變）', () => {
  it('商品：不存在或已下架算沒了；商店資料還沒載好時當作可用', () => {
    const gone = (c: ChatCard, l: Parameters<typeof cardTargetGone>[1]) => cardTargetGone(c, l);
    expect(gone(product, { productsLoaded: false, product: () => 'active', hasOrder: () => true })).toBe(false);
    expect(gone(product, { productsLoaded: true, product: () => 'active', hasOrder: () => true })).toBe(false);
    expect(gone(product, { productsLoaded: true, product: () => 'hidden', hasOrder: () => true })).toBe(true);
    expect(gone(product, { productsLoaded: true, product: () => undefined, hasOrder: () => true })).toBe(true);
  });
  it('訂單：載入完成後找不到才算沒了', () => {
    expect(cardTargetGone(order, { productsLoaded: true, product: () => 'active', hasOrder: () => false, ordersLoaded: true })).toBe(true);
    expect(cardTargetGone(order, { productsLoaded: true, product: () => 'active', hasOrder: () => false, ordersLoaded: false })).toBe(false);
    expect(cardTargetGone(order, { productsLoaded: true, product: () => 'active', hasOrder: () => true, ordersLoaded: true })).toBe(false);
  });
});

describe('待送出卡片', () => {
  it('小標與朗讀', () => {
    expect(pendingCardKicker(product)).toBe('商品・隨訊息送出');
    expect(pendingCardKicker(order)).toBe('訂單・隨訊息送出');
    expect(pendingCardSpoken(product, true)).toBe('待送出的商品卡，【Jy】Switch 任天堂 NS 咚奇剛，1000 元，隨訊息一起送出');
    expect(pendingCardSpoken(order, false)).toBe('待送出的訂單卡，訂單 261028SRPA9T6C，Switch 任天堂 NS 寶可夢等 2 件，訂單金額 1537 元，第一則訊息會附上這筆訂單');
  });
});
