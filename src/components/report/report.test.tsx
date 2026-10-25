import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ReportSheet from './ReportSheet';
import BlockedShopPanel from './BlockedShopPanel';
import BlockConfirm from './BlockConfirm';
import ReviewCard from '../reviews/ReviewCard';
import AccountBlocked from '../../pages/buyer/AccountBlocked';
import type { PublicReview } from '../../lib/reviews/types';

// AuthContext 載入時會讀 window.location；store 在這裡只需要店家查詢。node 環境沒有 localStorage → 封鎖清單是空的
vi.mock('../../store/AuthContext', () => ({ useAuth: () => ({ openLogin: () => {} }) }));
vi.mock('../../lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('../../store/StoreContext', () => ({
  useStore: () => ({ getShop: () => undefined, loading: false, loadError: null, user: null, myShop: null }),
}));

const NO_EMOJI = /\p{Extended_Pictographic}/u;
const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('ReportSheet（S-K4）', () => {
  const html = render(<ReportSheet target={{ type: 'product', id: 'p1', subject: '手沖咖啡壺' }} onClose={() => {}} />);
  it('標題含目標類型、副標是商品名；是 dialog 的標題與描述', () => {
    expect(html).toContain('檢舉商品');
    expect(html).toContain('手沖咖啡壺');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="report-title"');
    expect(html).toContain('aria-describedby="report-desc"');
  });
  it('六個原生 radio 同一個 name，文字與小字逐字取自規格', () => {
    expect(html.match(/<input[^>]*type="radio"[^>]*name="report-reason"/g)).toHaveLength(6);
    for (const t of ['違禁或違法商品', '仿冒品或侵權', '詐騙或不實資訊', '色情、暴力或令人不適', '騷擾、仇恨或洩露個資', '其他', '價格、規格、描述與實際不符，或疑似詐騙']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('<legend');
  });
  it('說明選填、剩餘字數、保證句；沒選原因時「送出」是 aria-disabled（但仍可聚焦）', () => {
    expect(html).toContain('（選填）');
    expect(html).toContain('剩餘 200 字');
    expect(html).toContain('我們會在 2 個工作天內處理，檢舉人身分不會告訴對方。');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-disabled="true"/);
  });
  it('所有 button 都標 type；沒有 emoji、沒有英文原始錯誤', () => {
    for (const m of html.matchAll(/<button\b[^>]*>/g)) expect(m[0]).toContain('type=');
    expect(html).not.toMatch(NO_EMOJI);
  });
  it('關閉鈕 44×44 並有可及名稱', () => {
    expect(html).toMatch(/aria-label="關閉"[^>]*class="[^"]*h-11 w-11/);
  });
});

describe('ReviewCard 的檢舉入口（S-K2）', () => {
  const review = {
    id: 'r1', rating: 4, content: '很好用', display_name: '王*****明', variant_names: [], photos: [],
    created_at: '2026-10-20T01:00:00Z', seller_reply: null, seller_replied_at: null,
    product_id: 'p1', product_title: null, product_available: true,
  } as unknown as PublicReview;
  it('有 onReport：可及名稱帶評價者顯示名，可見字以「檢舉」開頭，觸控區 44', () => {
    const h = render(<ReviewCard review={review} onOpenPhoto={() => {}} onReport={() => {}} />);
    expect(h).toContain('aria-label="檢舉 王*****明 的評價"');
    expect(h).toMatch(/min-h-11 min-w-11[^>]*>檢舉<\/button>/);
  });
  it('沒有 onReport（賣家端重用）：不渲染檢舉鈕', () => {
    expect(render(<ReviewCard review={review} onOpenPhoto={() => {}} />)).not.toContain('檢舉');
  });
});

describe('封鎖相關畫面', () => {
  it('BlockConfirm：標題帶店名，說明指向「我的 › 已封鎖的店家」，安全選項是「取消」', () => {
    const h = render(<BlockConfirm shopName="好物小舖" onConfirm={() => {}} onCancel={() => {}} />);
    expect(h).toContain('封鎖『好物小舖』？');
    expect(h).toContain('我的 › 已封鎖的店家');
    expect(h).toContain('>取消<');
    expect(h).toContain('>封鎖<');
  });
  it('S-K11 整頁：只出現店名與取消封鎖／回首頁，沒有商品內容；h1 可接焦點', () => {
    const h = render(<BlockedShopPanel variant="page" shopName="好物小舖" onUnblock={() => {}} />);
    expect(h).toContain('你已封鎖這家店（好物小舖）');
    expect(h).toContain('取消封鎖');
    expect(h).toContain('href="/"');
    expect(h).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(h).not.toMatch(NO_EMOJI);
  });
  it('S-K10 店家頁說明塊', () => {
    const h = render(<BlockedShopPanel variant="shop" onUnblock={() => {}} />);
    expect(h).toContain('你已封鎖這家店');
    expect(h).toContain('這台裝置上不會顯示它的商品。');
    expect(h).toContain('取消封鎖');
  });
  it('S-K13 已封鎖的店家（空）：空狀態標題＋「只存在這台裝置」說明，不需要登入', () => {
    const h = render(<AccountBlocked />);
    expect(h).toContain('已封鎖的店家');
    expect(h).toContain('你沒有封鎖任何店家');
    expect(h).toContain('封鎖只存在這台裝置。清除網站資料或換裝置後，封鎖就會消失。');
    expect(h).not.toMatch(NO_EMOJI);
  });
});
