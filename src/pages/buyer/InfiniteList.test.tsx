import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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

// navKind 記著「這份文件導覽過沒有」，所以每次渲染都重新載入模組圖，從乾淨的新文件開始；
// navigated＝true 模擬「已經 PUSH 過一次，現在 MemoryRouter 的 POP 是返回」。
// react-router 也要在同一個模組圖內重新載入，不然 Router 與頁面的 context 對不上
async function renderPage(page: 'home' | 'search', url: string, navigated: boolean) {
  vi.resetModules();
  const { MemoryRouter } = await import('react-router-dom');
  const { recordNavigation } = await import('../../lib/ui/navKind');
  const { default: Page } = page === 'home' ? await import('./Home') : await import('./Search');
  if (navigated) recordNavigation('PUSH');
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
}
const home = (navigated = false) => renderPage('home', '/', navigated);
const search = (url = '/search', navigated = false) => renderPage('search', url, navigated);

afterEach(() => vi.unstubAllGlobals());

describe('首頁「全部商品」：一批 24 件', () => {
  it('71 件：只畫 24 張卡，還沒到底所以沒有「回到頂端」；沒有 IntersectionObserver 時退回「顯示更多商品」按鈕', async () => {
    mock.products = make(71);
    const h = await home();
    expect(homeGridCards(h)).toBe(24);
    expect(h).toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('10 件：10 張卡，底下沒有任何按鈕', async () => {
    mock.products = make(10);
    const h = await home();
    expect(homeGridCards(h)).toBe(10);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('剛好 24 件：全畫、沒有按鈕（沒超過一批不放「回到頂端」）', async () => {
    mock.products = make(24);
    const h = await home();
    expect(homeGridCards(h)).toBe(24);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('返回（導覽過之後的 POP）且分頁有記憶 60 件：畫回 60 張卡', async () => {
    mock.products = make(71);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 1200 }) : null),
      setItem: () => {},
    });
    // MemoryRouter 的初始導覽種類是 POP
    expect(homeGridCards(await home(true))).toBe(60);
  });
  it('首次載入／重新整理（文件內還沒導覽過的 POP）即使分頁有記憶也不還原：只畫第一批', async () => {
    mock.products = make(71);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 1200 }) : null),
      setItem: () => {},
    });
    expect(homeGridCards(await home(false))).toBe(24);
  });
});

describe('資料變少自動截短', () => {
  it('返回記憶 60 件，但背景重讀後只剩 30 件：畫 30 張卡，不留空格', async () => {
    mock.products = make(30);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 0 }) : null),
      setItem: () => {},
    });
    const h = await home(true);
    expect(homeGridCards(h)).toBe(30);
    expect(h).not.toContain('顯示更多商品');
  });
});

describe('逛逛結果：一批 24 件', () => {
  it('71 件：只畫 24 張卡，退回「顯示更多商品」，沒有「回到頂端」', async () => {
    mock.products = make(71);
    const h = await search();
    expect(cards(h)).toBe(24);
    expect(h).toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('10 件：10 張卡，底下沒有任何按鈕', async () => {
    mock.products = make(10);
    const h = await search();
    expect(cards(h)).toBe(10);
    expect(h).not.toContain('顯示更多商品');
    expect(h).not.toContain('回到頂端');
  });
  it('記憶跟著篩選條件走：首頁的記憶不會套到逛逛', async () => {
    mock.products = make(71);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (k === 'reveal:home' ? JSON.stringify({ shown: 60, scrollY: 0 }) : null),
      setItem: () => {},
    });
    expect(cards(await search())).toBe(24);
  });
});
