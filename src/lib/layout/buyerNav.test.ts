import { describe, expect, it } from 'vitest';
import { hideBuyerTabBar, reserveForTabBar, showBuyerRail } from './buyerNav';

describe('手機底部膠囊的顯示（工單 C4）', () => {
  it('五個分頁根頁與購物車頁顯示；購物車成為分頁後不再隱藏', () => {
    for (const p of ['/', '/search', '/cart', '/orders', '/chat', '/account']) expect(hideBuyerTabBar(p), p).toBe(false);
  });

  it('有自己底部操作列或鍵盤的頁藏起來', () => {
    for (const p of ['/product/p1', '/product/p1/reviews', '/checkout', '/orders/o1/review', '/account/addresses/new', '/account/addresses/a1',
      '/account/payment-methods/new', '/account/payment-methods/result', '/account/bank-accounts/new', '/account/bank-accounts/verify', '/pay/x1', '/chat/c1', '/chat/new']) {
      expect(hideBuyerTabBar(p), p).toBe(true);
    }
  });

  it('購物車頁自己預留托盤＋膠囊的高度，外框不再多留', () => {
    expect(reserveForTabBar('/cart')).toBe(false);
    expect(reserveForTabBar('/')).toBe(true);
    expect(reserveForTabBar('/checkout')).toBe(false);
  });
});

describe('桌機浮動軌的顯示（D13、AC-C1、AC-C3）', () => {
  it('買家各頁都顯示，含商品頁、購物車頁、聊聊對話頁、帳號子頁', () => {
    for (const p of ['/', '/search', '/cart', '/orders', '/chat', '/account', '/product/p1', '/shop/s1', '/chat/c1', '/account/profile', '/account/addresses/new', '/orders/o1/review', '/privacy']) {
      expect(showBuyerRail(p), p).toBe(true);
    }
  });

  it('結帳與付款流程頁不顯示', () => {
    for (const p of ['/checkout', '/pay/x1', '/account/payment-methods/new', '/account/payment-methods/result', '/account/bank-accounts/new', '/account/bank-accounts/new/bank', '/account/bank-accounts/verify']) {
      expect(showBuyerRail(p), p).toBe(false);
    }
  });

  it('付款方式列表頁（不是流程中）仍顯示', () => {
    expect(showBuyerRail('/account/payment-methods')).toBe(true);
  });
});
