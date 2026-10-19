import { describe, expect, it } from 'vitest';
import { buildPending, savePending, type CheckoutAddress, type StorageLike } from '../auth/pending';
import { takeCheckoutSnapshot } from './resumeCheckout';

const mem = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
};
const ADDRESS: CheckoutAddress = { source: 'manual', bookId: null, name: '王', phone: '0912345678', zip: '', city: '臺北市', district: '大安區', detail: '某路1號', saveToBook: true };
const NOW = 1_800_000_000_000;
const checkout = () => buildPending({ kind: 'checkout', fromCart: true, payment: 'ecpay_card', cardId: 'c1', items: [{ productId: 'p', variantId: 'v', qty: 1 }], address: ADDRESS }, '/checkout', NOW);

describe('takeCheckoutSnapshot：綁卡／重新登入離開結帳後，回到結帳要還原的內容', () => {
  it('取出結帳快照並從儲存位置刪掉（只能用一次）', () => {
    const s = mem();
    savePending([s], checkout());
    expect(takeCheckoutSnapshot([s], NOW + 1000)).toMatchObject({ fromCart: true, payment: 'ecpay_card', cardId: 'c1', address: ADDRESS });
    expect(takeCheckoutSnapshot([s], NOW + 1000)).toBeNull();
  });
  it('過期（60 分鐘）的不還原，也不留下', () => {
    const s = mem();
    savePending([s], checkout());
    expect(takeCheckoutSnapshot([s], NOW + 61 * 60_000)).toBeNull();
    expect(takeCheckoutSnapshot([s], NOW + 1000)).toBeNull();
  });
  it('待辦動作不是結帳（例如加入購物車）：不動它，回 null', () => {
    const s = mem();
    savePending([s], buildPending({ kind: 'add_to_cart', productId: 'p', variantId: 'v', qty: 1 }, '/', NOW));
    expect(takeCheckoutSnapshot([s], NOW)).toBeNull();
    expect(s.getItem('goodmarket_pending_action')).not.toBeNull();
  });
  it('沒有任何待辦動作', () => {
    expect(takeCheckoutSnapshot([mem()], NOW)).toBeNull();
  });
});
