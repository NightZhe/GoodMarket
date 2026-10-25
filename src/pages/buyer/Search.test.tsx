import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Search from './Search';
import ShopPage from './ShopPage';

// 商品清單是空的：只驗空狀態文案與「看全部商品」何時出現（AC-23）
vi.mock('../../store/StoreContext', () => ({
  useStore: () => ({ products: [], shops: [], getShop: () => undefined }),
}));
// ShopPage 引入檢舉流程 → AuthContext（載入時會讀 window.location）；這裡是 node 環境，只驗找不到店的畫面，不需要真的登入狀態
vi.mock('../../store/AuthContext', () => ({ useAuth: () => ({ openLogin: () => {} }) }));
vi.mock('../../store/ReviewsContext', () => ({
  useReviews: () => ({ productStat: () => undefined, shopStat: () => undefined, summaryState: 'ready' }),
}));

const search = (url: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Search /></MemoryRouter>);

describe('搜尋／分類結果：空狀態', () => {
  it('有關鍵字：找不到『關鍵字』的商品，附「看全部商品」', () => {
    const h = search('/search?q=%E9%9D%A9%E5%91%BD');
    expect(h).toContain('找不到『革命』的商品');
    expect(h).toContain('看全部商品');
    expect(h).toContain('href="/search"');
  });
  it('只有分類：這個分類還沒有商品，附「看全部商品」', () => {
    const h = search('/search?cat=toys');
    expect(h).toContain('這個分類還沒有商品');
    expect(h).toContain('看全部商品');
  });
  it('關鍵字與分類都有：以關鍵字為準', () => {
    expect(search('/search?q=a&cat=toys')).toContain('找不到『a』的商品');
  });
  it('什麼條件都沒有：目前還沒有商品，不放「看全部商品」（已經在那一頁）；只有排序也一樣', () => {
    for (const url of ['/search', '/search?sort=newest']) {
      const h = search(url);
      expect(h).toContain('目前還沒有商品');
      expect(h).not.toContain('看全部商品');
    }
  });
  it('分類膠囊列：選中的 aria-pressed=true，沒有 emoji', () => {
    const h = search('/search?cat=toys');
    // 手機膠囊的玩具收藏、桌機側欄的玩具收藏、排序列的「綜合」
    expect(h.match(/aria-pressed="true"/g)?.length).toBe(3);
    expect(h).toContain('玩具收藏');
    expect(h).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('店頁：找不到店', () => {
  it('不存在的店：找不到這家商店＋回首頁', () => {
    const h = renderToStaticMarkup(<MemoryRouter initialEntries={['/shop/x']}><ShopPage /></MemoryRouter>);
    expect(h).toContain('找不到這家商店');
    expect(h).toContain('href="/"');
  });
});
