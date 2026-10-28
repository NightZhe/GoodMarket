import { describe, expect, it } from 'vitest';
import { hasSaveTray, hidesNav, sellerTabRoutes } from './sellerNav';

describe('hidesNav：哪些賣家頁不出現分頁導覽（膠囊與直立軌）', () => {
  it('物流店到店與地址表單頁有鍵盤，導覽隱藏（AC-25）', () => {
    expect(hidesNav('/seller/logistics/stores/new')).toBe(true);
    expect(hidesNav('/seller/logistics/stores/s1')).toBe(true);
    expect(hidesNav('/seller/logistics/address')).toBe(true);
  });

  it('物流設定列表本身與其他賣家頁都有導覽', () => {
    expect(hidesNav('/seller/logistics')).toBe(false);
    expect(hidesNav('/seller')).toBe(false);
    expect(hidesNav('/seller/products/new')).toBe(false);
    expect(hidesNav('/seller/orders')).toBe(false);
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

  it('固定 5 格，順序是賣場總覽、我的商品、新增商品、訂單管理、評價管理', () => {
    expect(sellerTabRoutes('/seller').map(t => t.key)).toEqual(['overview', 'products', 'new', 'orders', 'reviews']);
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
