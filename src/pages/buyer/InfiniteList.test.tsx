import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';
import Search from './Search';
import type { Product } from '../../types';

// 無限捲動：靜態渲染環境（node）沒有 window 與 IntersectionObserver，
// 所以這裡驗的是「第一批件數」與「退回按鈕」路徑；自動接續本身由真機／瀏覽器實測

const mock = vi.hoisted(() => ({ products: [] as Product[] }));
vi.mock('../../store/StoreContext', () => ({
  useStore: () => ({ products: mock.products, shops: [], getShop: () => undefined }),
}));
vi.mock('../../store/ReviewsContext', () => ({
  useReviews: () => ({ productStat: () => undefined, shopStat: () => undefined, summaryState: 'ready' }),
}));

const make = (n: number): Product[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    shopId: 's1',
    title: `商品${i}`,
    description: '',
    categoryId: 'home',
    images: ['https://example.com/a.jpg'],
    variants: [{ id: 'v1', name: '預設', price: 100 + i, stock: 5 }],
    sold: 100 - i,
    rating: 0,
    location: '台北',
    freeShipping: false,
    status: 'active',
    // 全部超過 7 天前：不觸發首頁故事卡
    createdAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString(),
  }));

const cards = (html: string) => html.match(/href="\/product\//g)?.length ?? 0;
/** 首頁只數「全部商品」標題之後的卡（上面還有貨架與分類列表列） */
const homeGridCards = (html: string) => cards(html.slice(html.indexOf('全部商品</h2>') + 1));

const home = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><Home /></MemoryRouter>);
const search = (url = '/search') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Search /></MemoryRouter>);

afterEach(() => vi.unstubAllGlobals());

describe('首頁「全部商品」：一批 24 件', () => {
  it('71 件：只畫 24 張卡，還沒到底所以沒有「回到頂端」；沒有 IntersectionObserver 時退回「顯示更多商品」按鈕', () => {
    mock.products = make(71);
    const h = home();
    expect(homeGridCards(h)).toBe(24);
    expect(h).toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('10 件：10 張卡，底下沒有任何按鈕', () => {
    mock.products = make(10);
    const h = home();
    expect(homeGridCards(h)).toBe(10);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('剛好 24 件：全畫、沒有按鈕（沒超過一批不放「回到頂端」）', () => {
    mock.products = make(24);
    const h = home();
    expect(homeGridCards(h)).toBe(24);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('返回（POP）且分頁有記憶 60 件：畫回 60 張卡；其餘導覽種類不讀記憶', () => {
    mock.products = make(71);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 1200 }) : null),
      setItem: () => {},
    });
    // MemoryRouter 的初始導覽種類是 POP
    expect(homeGridCards(home())).toBe(60);
  });
});

describe('資料變少自動截短', () => {
  it('返回記憶 60 件，但背景重讀後只剩 30 件：畫 30 張卡，不留空格', () => {
    mock.products = make(30);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 0 }) : null),
      setItem: () => {},
    });
    const h = home();
    expect(homeGridCards(h)).toBe(30);
    expect(h).not.toContain('顯示更多商品');
  });
});

describe('逛逛結果：一批 24 件', () => {
  it('71 件：只畫 24 張卡，退回「顯示更多商品」，沒有「回到頂端」', () => {
    mock.products = make(71);
    const h = search();
    expect(cards(h)).toBe(24);
    expect(h).toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('10 件：10 張卡，底下沒有任何按鈕', () => {
    mock.products = make(10);
    const h = search();
    expect(cards(h)).toBe(10);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('記憶跟著篩選條件走：首頁的記憶不會套到逛逛', () => {
    mock.products = make(71);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 0 }) : null),
      setItem: () => {},
    });
    expect(cards(search())).toBe(24);
  });
});
