import { describe, expect, it } from 'vitest';
import { headerFor } from './headerKind';

describe('headerFor：依路徑決定買家前台的頁首樣式', () => {
  it('分頁根頁是大標題；購物車與搜尋框只在首頁與逛逛', () => {
    expect(headerFor('/')).toEqual({ kind: 'large', title: '好物集', cart: true, search: true });
    expect(headerFor('/search')).toEqual({ kind: 'large', title: '逛逛', cart: true, search: true });
    expect(headerFor('/orders')).toEqual({ kind: 'large', title: '訂單', cart: false, search: false });
    expect(headerFor('/account')).toEqual({ kind: 'large', title: '我的', cart: false, search: false });
  });

  it('商品頁：返回「首頁」，右側有分享與購物車，分享要帶商品編號', () => {
    expect(headerFor('/product/p001')).toEqual({
      kind: 'nav', back: { to: '/', label: '首頁' }, cart: true, share: { kind: 'product', id: 'p001' },
    });
  });

  it('商品評價頁：返回「商品」，只有購物車', () => {
    expect(headerFor('/product/p001/reviews')).toEqual({
      kind: 'nav', back: { to: '/product/p001', label: '商品' }, cart: true, share: null,
    });
  });

  it('店家頁返回「首頁」，右側有分享（帶店家編號）與購物車', () => {
    expect(headerFor('/shop/s1')).toEqual({
      kind: 'nav', back: { to: '/', label: '首頁' }, cart: true, share: { kind: 'shop', id: 's1' },
    });
  });

  it('隱私政策返回「首頁」，沒有分享', () => {
    expect(headerFor('/privacy')).toEqual({ kind: 'nav', back: { to: '/', label: '首頁' }, cart: true, share: null });
  });

  it('購物車頁返回「首頁」，且不放指向自己的購物車鈕', () => {
    expect(headerFor('/cart')).toEqual({ kind: 'nav', back: { to: '/', label: '首頁' }, cart: false, share: null });
  });

  it('結帳返回「購物車」', () => {
    expect(headerFor('/checkout')).toMatchObject({ kind: 'nav', back: { to: '/cart', label: '購物車' }, cart: true });
  });

  it('評價表單與付款結果返回「訂單」', () => {
    for (const p of ['/orders/o1/review', '/pay/pay_1']) {
      expect(headerFor(p)).toMatchObject({ kind: 'nav', back: { to: '/orders', label: '訂單' }, cart: true });
    }
  });

  it('帳號子頁自己有導覽列，這裡只放安全區條', () => {
    for (const p of ['/account/profile', '/account/addresses', '/account/addresses/new', '/account/payment-methods/result']) {
      expect(headerFor(p)).toEqual({ kind: 'plain' });
    }
  });

  it('結尾斜線不影響判斷；沒見過的路徑退回安全區條', () => {
    expect(headerFor('/cart/')).toMatchObject({ kind: 'nav', back: { label: '首頁' } });
    expect(headerFor('/orders/')).toMatchObject({ kind: 'large', title: '訂單' });
    expect(headerFor('/somewhere/else')).toEqual({ kind: 'plain' });
  });
});
