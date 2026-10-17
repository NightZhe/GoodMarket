import { describe, expect, it } from 'vitest';
import { autoNoticeText, checkAutoAction, reasonFromDbCode } from './autoAction';
import { PENDING_TTL_MS, buildPending, type PendingAction } from './pending';
import type { Product } from '../../types';

const NOW = 1_800_000_000_000;
const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', shopId: 's1', title: '精華液', description: '', categoryId: 'beauty', images: [],
  variants: [{ id: 'v1', name: '30ml', price: 100, stock: 5 }, { id: 'v0', name: '50ml', price: 200, stock: 0 }],
  sold: 0, rating: 0, location: '', freeShipping: false, status: 'active', createdAt: '', ...over,
});
const action = (variantId = 'v1', qty = 3, createdAt = NOW): Extract<PendingAction, { kind: 'add_to_cart' }> =>
  ({ ...(buildPending({ kind: 'add_to_cart', productId: 'p1', variantId, qty }, '/', createdAt) as Extract<PendingAction, { kind: 'add_to_cart' }>) });
const check = (a = action(), p: Product | null = product(), myShopId: string | null = null, now = NOW) =>
  checkAutoAction({ action: a, now, product: p ?? undefined, myShopId, shopName: '小花雜貨' });

describe('checkAutoAction：七種情況裡的前六種（第七種是動作本身失敗，在執行時才知道）', () => {
  it('都正常：可以執行', () => expect(check()).toEqual({ ok: true }));
  it('庫存剛好等於數量：可以執行', () => expect(check(action('v1', 5))).toEqual({ ok: true }));
  it('1 超過 60 分鐘', () => expect(check(action(), product(), null, NOW + PENDING_TTL_MS)).toMatchObject({ ok: false, reason: 'expired' }));
  it('2 商品下架', () => expect(check(action(), product({ status: 'hidden' }))).toMatchObject({ ok: false, reason: 'unavailable' }));
  it('2 商品不存在', () => expect(check(action(), null)).toMatchObject({ ok: false, reason: 'unavailable' }));
  it('3 自己商店的商品', () => expect(check(action(), product(), 's1')).toMatchObject({ ok: false, reason: 'own_shop', shopName: '小花雜貨' }));
  it('3 別家店的店主可以買', () => expect(check(action(), product(), 'other')).toEqual({ ok: true }));
  it('4 規格不存在', () => expect(check(action('gone'))).toMatchObject({ ok: false, reason: 'variant_missing' }));
  it('5 規格已售完', () => expect(check(action('v0', 1))).toMatchObject({ ok: false, reason: 'sold_out', variantName: '50ml' }));
  it('6 庫存不足', () => expect(check(action('v1', 6))).toMatchObject({ ok: false, reason: 'insufficient_stock', variantName: '30ml', stock: 5, qty: 6 }));
  it('過期優先於其他原因（使用者最該知道的是「登入花了太久」）', () =>
    expect(check(action('gone'), null, null, NOW + PENDING_TTL_MS)).toMatchObject({ reason: 'expired' }));
});

describe('autoNoticeText：逐字照設計文案', () => {
  it('規格不存在', () => expect(autoNoticeText('cart', 'variant_missing')).toEqual({ kind: 'warning', title: '沒有加入購物車', body: '你選的規格已經不存在，請重新選擇規格。' }));
  it('庫存不足（加入）', () => expect(autoNoticeText('cart', 'insufficient_stock', { variantName: '30ml', stock: 2, qty: 3 }).body).toBe('「30ml」目前只剩 2 件，你選了 3 件。請調整數量後再加入。'));
  it('庫存不足（購買）', () => expect(autoNoticeText('buy', 'insufficient_stock', { variantName: '30ml', stock: 2, qty: 3 })).toMatchObject({ title: '沒有進入結帳', body: expect.stringContaining('請調整數量後再購買') }));
  it('已售完', () => expect(autoNoticeText('cart', 'sold_out', { variantName: '50ml' }).body).toBe('「50ml」已經售完了，請改選其他規格。'));
  it('自己商店：info，不是使用者的錯', () => {
    const t = autoNoticeText('cart', 'own_shop', { shopName: '小花雜貨' });
    expect(t).toEqual({ kind: 'info', title: '不能購買自己商店的商品', body: '你登入的帳號是「小花雜貨」的店主，所以沒有加入購物車。' });
  });
  it('超過 60 分鐘', () => expect(autoNoticeText('cart', 'expired')).toEqual({ kind: 'info', title: '登入花了比較久，沒有自動加入購物車', body: '為了避免誤加，請確認你的選擇後，再按一次「加入購物車」。' }));
  it('商品已下架', () => expect(autoNoticeText('cart', 'unavailable')).toEqual({ kind: 'warning', title: '商品已下架，沒有加入購物車', body: '你可以回首頁看看其他商品。' }));
  it('動作失敗：error', () => expect(autoNoticeText('cart', 'failed')).toEqual({ kind: 'error', title: '加入購物車失敗', body: '網路好像不太穩。你的選擇還在，再試一次。' }));
  it('直接購買的標題與逾時文案換成結帳', () => {
    expect(autoNoticeText('buy', 'expired').title).toBe('登入花了比較久，沒有自動進入結帳');
    expect(autoNoticeText('buy', 'unavailable').title).toBe('商品已下架，沒有進入結帳');
  });
});

describe('reasonFromDbCode：資料庫擋下時走同一套說明', () => {
  it.each([['PRODUCT_UNAVAILABLE', 'unavailable'], ['VARIANT_NOT_FOUND', 'variant_missing'], ['OUT_OF_STOCK', 'sold_out'], ['OWN_SHOP', 'own_shop'], ['QTY_INVALID', null], [null, null]] as const)
    ('%s → %s', (c, r) => expect(reasonFromDbCode(c)).toBe(r));
});
