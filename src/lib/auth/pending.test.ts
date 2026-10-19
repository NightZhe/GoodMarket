import { describe, expect, it } from 'vitest';
import {
  PENDING_KEY, PENDING_TTL_MS, buildPending, canPersist, clearPending, isSafeRoute, parsePending, paramsToPending,
  peekPending, pendingToParams, savePending, takePending, type CheckoutAddress, type PendingAction, type StorageLike,
} from './pending';

const mem = (opts: { failWrite?: boolean } = {}): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (opts.failWrite) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
};

const NOW = 1_800_000_000_000;
const ADDRESS: CheckoutAddress = {
  source: 'book', bookId: 'a-1', name: '王小明', phone: '0912345678',
  zip: '106', city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓', saveToBook: false,
};
const cart = (over: Partial<PendingAction> = {}) =>
  ({ ...buildPending({ kind: 'add_to_cart', productId: 'p1', variantId: 'v1', qty: 3 }, '/', NOW), ...over }) as PendingAction;
const checkout = () => buildPending({
  kind: 'checkout', fromCart: true, payment: 'transfer', cardId: null,
  items: [{ productId: 'p1', variantId: 'v1', qty: 2 }, { productId: 'p2', variantId: 'v9', qty: 1 }],
  address: ADDRESS,
}, '/checkout', NOW);

describe('buildPending', () => {
  it('加入購物車、直接購買固定回到商品頁，不看目前網址', () => {
    expect(cart().returnTo).toBe('/product/p1');
    expect(buildPending({ kind: 'buy_now', productId: 'p1', variantId: 'v1', qty: 1 }, '/search', NOW).returnTo).toBe('/product/p1');
  });
  it('結帳回結帳頁；純登入回目前頁面', () => {
    expect(checkout().returnTo).toBe('/checkout');
    expect(buildPending({ kind: 'goto' }, '/orders', NOW).returnTo).toBe('/orders');
  });
  it('目前網址不是站內路徑時退回首頁', () => {
    expect(buildPending({ kind: 'goto' }, '//evil.com', NOW).returnTo).toBe('/');
  });
});

describe('存取：只執行一次', () => {
  it('take 讀出來之後，兩個儲存位置都被清掉，第二次拿不到', () => {
    const a = mem(); const b = mem();
    savePending([a, b], cart());
    expect(takePending([a, b], NOW)?.action).toMatchObject({ kind: 'add_to_cart', qty: 3 });
    expect(a.data.has(PENDING_KEY) || b.data.has(PENDING_KEY)).toBe(false);
    expect(takePending([a, b], NOW)).toBeNull();
  });
  it('peek 不會取走（商品頁用來還原規格與數量）', () => {
    const a = mem();
    savePending([a], cart());
    expect(peekPending([a], NOW)).not.toBeNull();
    expect(peekPending([a], NOW)).not.toBeNull();
  });
  it('同一時間只保留最新一筆', () => {
    const a = mem();
    savePending([a], cart({ qty: 1 } as Partial<PendingAction>));
    savePending([a], cart({ qty: 5 } as Partial<PendingAction>));
    expect(takePending([a], NOW)?.action).toMatchObject({ qty: 5 });
  });
  it('sessionStorage 優先；它是空的時從 localStorage 讀到', () => {
    const s = mem(); const l = mem();
    savePending([l], cart());
    expect(takePending([s, l], NOW)).not.toBeNull();
  });
  it('其中一個儲存位置寫不進去，另一個成功就算成功', () => {
    const bad = mem({ failWrite: true }); const good = mem();
    expect(savePending([bad, good], cart())).toBe(true);
    expect(takePending([bad, good], NOW)).not.toBeNull();
  });
  it('兩個都寫不進去：回傳 false（畫面要提醒登入後無法自動完成）', () => {
    expect(savePending([mem({ failWrite: true })], cart())).toBe(false);
    expect(canPersist([mem({ failWrite: true })])).toBe(false);
    expect(canPersist([mem()])).toBe(true);
    expect(canPersist([])).toBe(false);
  });
  it('clear 清掉全部位置', () => {
    const a = mem(); const b = mem();
    savePending([a, b], cart());
    clearPending([a, b]);
    expect(peekPending([a, b], NOW)).toBeNull();
  });
});

describe('60 分鐘過期', () => {
  it('59 分 59 秒還有效，滿 60 分鐘過期；過期的仍讀得到（要說明原因），但標記 expired', () => {
    const a = mem();
    savePending([a], cart());
    expect(peekPending([a], NOW + PENDING_TTL_MS - 1000)?.expired).toBe(false);
    expect(peekPending([a], NOW + PENDING_TTL_MS)?.expired).toBe(true);
  });
});

describe('壞資料一律丟掉', () => {
  it.each([
    ['null', null], ['空字串', ''], ['不是 JSON', '{x'], ['陣列', '[]'],
    ['未知種類', JSON.stringify({ kind: 'hack', returnTo: '/', createdAt: NOW })],
    ['數量 0', JSON.stringify({ ...cart(), qty: 0 })],
    ['數量太大', JSON.stringify({ ...cart(), qty: 1000 })],
    ['小數數量', JSON.stringify({ ...cart(), qty: 1.5 })],
    ['商品 id 是物件', JSON.stringify({ ...cart(), productId: {} })],
    ['returnTo 是外部網址', JSON.stringify({ ...cart(), returnTo: 'https://evil.com' })],
    ['returnTo 是 //', JSON.stringify({ ...cart(), returnTo: '//evil.com/x' })],
    ['沒有時間', JSON.stringify({ ...cart(), createdAt: undefined })],
    ['結帳付款方式不認得', JSON.stringify({ ...checkout(), payment: 'bitcoin' })],
    ['結帳品項是空的', JSON.stringify({ ...checkout(), items: [] })],
    ['結帳品項有壞資料', JSON.stringify({ ...checkout(), items: [{ productId: 'p', variantId: 'v', qty: 0 }] })],
    ['結帳 fromCart 不是布林', JSON.stringify({ ...checkout(), fromCart: 'yes' })],
    ['結帳沒有收件資料', JSON.stringify({ ...checkout(), address: null })],
    ['結帳收件資料來源不認得', JSON.stringify({ ...checkout(), address: { ...ADDRESS, source: 'cloud' } })],
    ['結帳收件資料欄位不是字串', JSON.stringify({ ...checkout(), address: { ...ADDRESS, zip: 106 } })],
    ['結帳收件資料還是舊格式（單一地址字串）', JSON.stringify({ ...checkout(), address: undefined, buyer: { name: '甲', phone: '0912345678', address: '某地' } })],
  ])('%s', (_l, raw) => {
    expect(parsePending(raw)).toBeNull();
  });
  it('壞資料在 take 時也會被刪掉', () => {
    const a = mem();
    a.setItem(PENDING_KEY, '{x');
    expect(takePending([a], NOW)).toBeNull();
    expect(a.data.has(PENDING_KEY)).toBe(false);
  });
});

describe('結帳狀態完整保存', () => {
  it('選了哪張信用卡（線上付款）也存得進去、讀得回來；舊紀錄沒有這個欄位＝沒選卡', () => {
    const a = mem();
    const online = buildPending({ kind: 'checkout', fromCart: true, payment: 'ecpay_card', cardId: 'card-1', items: [{ productId: 'p1', variantId: 'v1', qty: 1 }], address: ADDRESS }, '/checkout', NOW);
    savePending([a], online);
    expect(takePending([a], NOW)!.action).toMatchObject({ kind: 'checkout', payment: 'ecpay_card', cardId: 'card-1' });
    const old = { ...checkout(), cardId: undefined };
    expect(parsePending(JSON.stringify(old))).toMatchObject({ kind: 'checkout', cardId: null });
    expect(parsePending(JSON.stringify({ ...checkout(), cardId: { x: 1 } }))).toBeNull();
  });
  it('全部品項、fromCart、付款方式、收件資料都存得進去、讀得回來', () => {
    const a = mem();
    savePending([a], checkout());
    const got = takePending([a], NOW)!.action;
    expect(got).toMatchObject({
      kind: 'checkout', fromCart: true, payment: 'transfer',
      items: [{ productId: 'p1', variantId: 'v1', qty: 2 }, { productId: 'p2', variantId: 'v9', qty: 1 }],
      address: ADDRESS,
    });
  });
  it('手填的收件資料與「存到我的地址」勾選狀態也原樣還原（R-A16、7.5）', () => {
    const a = mem();
    const manual: CheckoutAddress = { ...ADDRESS, source: 'manual', bookId: null, saveToBook: true, zip: '', district: '' };
    savePending([a], buildPending({ kind: 'checkout', fromCart: false, payment: 'cod', cardId: null, items: [{ productId: 'p1', variantId: 'v1', qty: 1 }], address: manual }, '/checkout', NOW));
    expect(takePending([a], NOW)!.action).toMatchObject({ kind: 'checkout', address: manual });
  });
  it('地址簿那筆事後被刪了，快照仍完整（AC-A25：還原不靠地址編號）', () => {
    const a = mem();
    savePending([a], checkout());
    const got = takePending([a], NOW)!.action;
    expect(got.kind === 'checkout' && got.address).toMatchObject({ name: '王小明', zip: '106', city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓' });
  });
  it('收件資料不放網址：結帳不能編成外開參數', () => {
    expect(pendingToParams(checkout())).toBeNull();
  });
});

describe('LINE 外開：待辦動作放網址', () => {
  it('加入購物車編成參數再還原，內容一致', () => {
    const p = pendingToParams(cart())!;
    expect(paramsToPending(p, '/', NOW)).toEqual(cart());
  });
  it('直接購買、純登入也行', () => {
    const buy = buildPending({ kind: 'buy_now', productId: 'p9', variantId: 'v9', qty: 2 }, '/', NOW);
    expect(paramsToPending(pendingToParams(buy)!, '/', NOW)).toEqual(buy);
    const login = buildPending({ kind: 'goto' }, '/orders', NOW);
    expect(paramsToPending(pendingToParams(login)!, '/orders', NOW)).toEqual(login);
  });
  it('沒有 pa 參數＝沒有待辦動作', () => {
    expect(paramsToPending(new URLSearchParams('openExternalBrowser=1'), '/', NOW)).toBeNull();
  });
  it.each([
    'pa=cart&pp=p1&pv=v1&pq=0', 'pa=cart&pp=p1&pv=v1&pq=abc', 'pa=cart&pp=&pv=v1&pq=1',
    'pa=cart&pv=v1&pq=1', 'pa=evil&pp=p1&pv=v1&pq=1', `pa=cart&pp=${'x'.repeat(200)}&pv=v1&pq=1`,
  ])('網址被亂改：%s', q => {
    expect(paramsToPending(new URLSearchParams(q), '/', NOW)).toBeNull();
  });
  it('時間戳記不能是未來（改網址想讓它永遠不過期），也不能讓過期的復活', () => {
    const future = paramsToPending(new URLSearchParams(`pa=cart&pp=p1&pv=v1&pq=1&pt=${NOW + 10 * PENDING_TTL_MS}`), '/', NOW)!;
    expect(future.createdAt).toBe(NOW);
    const old = paramsToPending(new URLSearchParams(`pa=cart&pp=p1&pv=v1&pq=1&pt=${NOW - 2 * PENDING_TTL_MS}`), '/', NOW)!;
    expect(peekPending([(() => { const m = mem(); savePending([m], old); return m; })()], NOW)?.expired).toBe(true);
  });
});

describe('isSafeRoute', () => {
  it.each(['/', '/product/p1', '/orders/abc/review', '/search?q=%E8%B2%93'])('合法：%s', r => expect(isSafeRoute(r)).toBe(true));
  it.each(['', 'product', '//x.com', 'https://x.com', '/a b', '/a\\b', null, 5])('不合法：%s', r => expect(isSafeRoute(r)).toBe(false));
});
