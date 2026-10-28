import { describe, expect, it } from 'vitest';
import { hasSaveTray, hidesNav, isChatThreadPath, sellerTabRoutes } from './sellerNav';

describe('hidesNav：哪些賣家頁不出現分頁導覽（膠囊與直立軌）', () => {
  it('物流店到店與地址表單頁有鍵盤，導覽隱藏（AC-25）', () => {
    expect(hidesNav('/seller/logistics/stores/new')).toBe(true);
    expect(hidesNav('/seller/logistics/stores/s1')).toBe(true);
    expect(hidesNav('/seller/logistics/address')).toBe(true);
  });

  it('聊聊對話頁有輸入列與鍵盤，導覽隱藏；聊聊列表頁與從訂單進的新對話頁（也是對話頁）照規則', () => {
    expect(hidesNav('/seller/chat/c1')).toBe(true);
    expect(hidesNav('/seller/chat/new')).toBe(true);
    expect(hidesNav('/seller/chat')).toBe(false);
  });

  it('物流設定列表本身與其他賣家頁都有導覽', () => {
    expect(hidesNav('/seller/logistics')).toBe(false);
    expect(hidesNav('/seller')).toBe(false);
    expect(hidesNav('/seller/products/new')).toBe(false);
    expect(hidesNav('/seller/orders')).toBe(false);
  });
});

describe('isChatThreadPath：賣家聊聊的對話頁（手機版隱藏賣家頂欄、版面無內距）', () => {
  it('對話頁與從訂單進的新對話頁是，列表頁與其他賣家頁不是', () => {
    expect(isChatThreadPath('/seller/chat/c1')).toBe(true);
    expect(isChatThreadPath('/seller/chat/new')).toBe(true);
    expect(isChatThreadPath('/seller/chat')).toBe(false);
    expect(isChatThreadPath('/seller/chatter')).toBe(false);
    expect(isChatThreadPath('/seller/orders')).toBe(false);
    expect(isChatThreadPath('/chat/c1')).toBe(false);
  });
});

describe('hasSaveTray：哪些賣家頁底部有儲存托盤', () => {
  it('新增與編輯商品有', () => {
    expect(hasSaveTray('/seller/products/new')).toBe(true);
    expect(hasSaveTray('/seller/products/p123/edit')).toBe(true);
  });

  it('商品列表、匯入精靈、其他頁沒有', () => {
    expect(hasSaveTray('/seller/products')).toBe(false);
    expect(hasSaveTray('/seller/products/import')).toBe(false);
    expect(hasSaveTray('/seller')).toBe(false);
    expect(hasSaveTray('/seller/orders')).toBe(false);
  });
});

describe('sellerTabRoutes：5 個分頁的導覽目標與選中', () => {
  const at = (pathname: string) => Object.fromEntries(sellerTabRoutes(pathname).map(t => [t.key, t]));

  it('固定 5 格，順序是總覽、聊聊、商品、新增、訂單（使用者定版，評價管理退出底欄）', () => {
    expect(sellerTabRoutes('/seller').map(t => t.key)).toEqual(['overview', 'chat', 'products', 'new', 'orders']);
  });

  it('聊聊格的目的地是 /seller/chat；在對話頁時代為選中', () => {
    expect(at('/seller/chat').chat).toMatchObject({ to: '/seller/chat', goTo: '/seller/chat' });
    expect(at('/seller/chat/c1').chat).toMatchObject({ to: '/seller/chat/c1', goTo: '/seller/chat' });
    expect(at('/seller/chat/new').chat).toMatchObject({ to: '/seller/chat/new', goTo: '/seller/chat' });
  });

  it('評價管理頁 /seller/reviews：底欄亮「總覽」（它的入口在總覽），點下去回總覽（規格 §12.1）', () => {
    const tabs = at('/seller/reviews');
    expect(tabs.overview).toMatchObject({ to: '/seller/reviews', goTo: '/seller' });
    expect(tabs.orders.to).toBe('/seller/orders');
    expect(tabs.chat.to).toBe('/seller/chat');
  });

  it('一般頁面：to 就是自己的路徑，不需要攔截', () => {
    const tabs = at('/seller/orders');
    expect(tabs.orders).toMatchObject({ to: '/seller/orders', goTo: '/seller/orders' });
    expect(tabs.overview.goTo).toBe('/seller');
  });

  it('匯入精靈：「我的商品」代為選中（to 換成目前路徑），點下去仍回商品列表', () => {
    const tabs = at('/seller/products/import');
    expect(tabs.products).toMatchObject({ to: '/seller/products/import', goTo: '/seller/products' });
    expect(tabs.new.to).toBe('/seller/products/new');
  });

  it('物流設定列表：「賣場總覽」代為選中，點下去回總覽', () => {
    const tabs = at('/seller/logistics');
    expect(tabs.overview).toMatchObject({ to: '/seller/logistics', goTo: '/seller' });
  });

  it('編輯商品頁沒有任何分頁代選中', () => {
    const tabs = sellerTabRoutes('/seller/products/p1/edit');
    expect(tabs.every(t => t.to === t.goTo)).toBe(true);
  });
});
