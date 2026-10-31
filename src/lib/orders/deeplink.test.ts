import { describe, expect, it } from 'vitest';
import { afterLocate, buyerTabForOrder, orderDeepLink, scrollBlockFor, tabFromQuery, tabOnlySearch } from './deeplink';

describe('orderDeepLink：聊聊訂單卡帶訂單 id 直達訂單頁', () => {
  it('買家連 /orders、賣家連 /seller/orders，都帶 ?order=<id>', () => {
    expect(orderDeepLink('/orders', 'abc-123')).toBe('/orders?order=abc-123');
    expect(orderDeepLink('/seller/orders', 'abc-123')).toBe('/seller/orders?order=abc-123');
  });
  it('id 會編碼，不能夾帶其他參數', () => {
    expect(orderDeepLink('/orders', 'a&tab=completed')).toBe('/orders?order=a%26tab%3Dcompleted');
  });
});

describe('tabFromQuery：?tab= 認所有分頁值，其餘當預設', () => {
  const buyer = ['all', 'pending', 'to_ship', 'shipping', 'completed', 'cancelled'] as const;
  it('合法值照用（含待付款）', () => {
    expect(tabFromQuery('pending', buyer, 'all')).toBe('pending');
    expect(tabFromQuery('shipping', buyer, 'all')).toBe('shipping');
    expect(tabFromQuery('cancelled', buyer, 'all')).toBe('cancelled');
  });
  it('沒有、空字串、亂寫都是預設', () => {
    expect(tabFromQuery(null, buyer, 'all')).toBe('all');
    expect(tabFromQuery('', buyer, 'all')).toBe('all');
    expect(tabFromQuery('<script>', buyer, 'all')).toBe('all');
  });
  it('分頁此刻不存在（待付款分頁還沒出現）也當預設，等它出現再切過去', () => {
    const noPending = ['all', 'to_ship', 'shipping', 'completed', 'cancelled'] as const;
    expect(tabFromQuery('pending', noPending, 'all')).toBe('all');
  });
  it('賣家預設是待出貨', () => {
    const seller = ['all', 'to_ship', 'shipping', 'completed', 'cancelled'] as const;
    expect(tabFromQuery(null, seller, 'to_ship')).toBe('to_ship');
    expect(tabFromQuery('completed', seller, 'to_ship')).toBe('completed');
  });
});

describe('buyerTabForOrder：那筆訂單「目前」該在哪個分頁', () => {
  it('照訂單狀態', () => {
    expect(buyerTabForOrder('shipping', false, true)).toBe('shipping');
    expect(buyerTabForOrder('completed', false, false)).toBe('completed');
  });
  it('還沒付完款的線上單在待付款；待付款分頁還沒出現時退回全部', () => {
    expect(buyerTabForOrder('to_ship', true, true)).toBe('pending');
    expect(buyerTabForOrder('to_ship', true, false)).toBe('all');
  });
});

describe('網址寫回', () => {
  it('手動切分頁：只留 tab，order 拿掉', () => {
    expect(tabOnlySearch('completed').toString()).toBe('tab=completed');
  });
  it('找到那筆：tab 改成它目前的分頁，order 留著', () => {
    expect(afterLocate(new URLSearchParams('order=x1'), 'shipping').toString()).toBe('order=x1&tab=shipping');
    expect(afterLocate(new URLSearchParams('tab=all&order=x1'), 'completed').toString()).toBe('tab=completed&order=x1');
  });
  it('找不到：拿掉 order，原本的 tab 不動', () => {
    expect(afterLocate(new URLSearchParams('order=x1'), null).toString()).toBe('');
    expect(afterLocate(new URLSearchParams('tab=completed&order=x1'), null).toString()).toBe('tab=completed');
  });
});

describe('scrollBlockFor：卡片超過視窗七成高就對齊頂端，否則置中', () => {
  it('一般卡置中', () => { expect(scrollBlockFor(300, 812)).toBe('center'); expect(scrollBlockFor(560, 812)).toBe('center'); });
  it('展開後很高的卡對齊頂端（置中會切掉頂端或壓到底部膠囊）', () => { expect(scrollBlockFor(600, 812)).toBe('start'); expect(scrollBlockFor(900, 812)).toBe('start'); });
});
