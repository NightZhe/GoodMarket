import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TabCell } from '../../components/glass/tabs';
import { buildSellerTabs } from './sellerTabs';

const counts = { toShip: 0, pending: 0, chatBadge: 0 };
const items = (pathname: string, c: Partial<typeof counts> = {}) => buildSellerTabs({ pathname, ...counts, ...c, goTo: () => undefined });
const html = (pathname: string, c: Partial<typeof counts> = {}) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[pathname]}>
    {items(pathname, c).map(item => <TabCell key={item.to} item={item} kind="pill" labeled />)}
  </MemoryRouter>,
);
const cells = (h: string) => h.match(/<a [^>]*>.*?<\/a>/g) ?? [];

describe('賣家底欄五格（AC-M35、N2＝A）', () => {
  it('標籤依序是 總覽／聊聊／商品／新增／訂單（短字），評價管理不在底欄', () => {
    const labels = items('/seller').map(i => i.label);
    expect(labels).toEqual(['總覽', '聊聊', '商品', '新增', '訂單']);
    expect(html('/seller')).not.toContain('評價');
  });

  it('聊聊格：0 條未讀朗讀「聊聊」、不畫角標', () => {
    const chat = cells(html('/seller'))[1];
    expect(chat).toContain('aria-label="聊聊"');
    expect(chat).not.toContain('bg-badge');
  });

  it('聊聊格：3 條未讀朗讀「聊聊，3 條未讀」、角標 3（角標本身 aria-hidden）', () => {
    const chat = cells(html('/seller', { chatBadge: 3 }))[1];
    expect(chat).toContain('aria-label="聊聊，3 條未讀"');
    expect(chat).toMatch(/<span aria-hidden="true" class="[^"]*bg-badge[^"]*">3<\/span>/);
  });

  it('聊聊格：超過 99 顯示 99+，朗讀「聊聊，99 條以上未讀」', () => {
    const chat = cells(html('/seller', { chatBadge: 150 }))[1];
    expect(chat).toContain('aria-label="聊聊，99 條以上未讀"');
    expect(chat).toContain('>99+<');
  });

  it('訂單格的既有角標與朗讀不變：待出貨角標、取消申請朗讀', () => {
    const orders = cells(html('/seller', { toShip: 2, pending: 1 }))[4];
    expect(orders).toContain('aria-label="訂單管理，待出貨 2 筆，取消申請 1 筆"');
    expect(orders).toContain('>2<');
    const plain = cells(html('/seller', { toShip: 2 }))[4];
    expect(plain).toContain('aria-label="訂單"');
    // 聊聊與訂單的角標互不影響
    expect(cells(html('/seller', { toShip: 2 }))[1]).not.toContain('bg-badge');
  });

  it('評價管理頁 #/seller/reviews：底欄亮「總覽」，其餘都不亮', () => {
    const lit = cells(html('/seller/reviews')).map(c => c.includes('aria-current="page"'));
    expect(lit).toEqual([true, false, false, false, false]);
  });

  it('一般頁面各亮自己的格：/seller/chat 亮聊聊、/seller/orders 亮訂單', () => {
    expect(cells(html('/seller/chat')).map(c => c.includes('aria-current="page"'))).toEqual([false, true, false, false, false]);
    expect(cells(html('/seller/orders')).map(c => c.includes('aria-current="page"'))).toEqual([false, false, false, false, true]);
  });
});
