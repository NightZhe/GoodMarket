import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import SellerTopBar from './SellerTopBar';

// 只測右上群組有哪些項目（純標記）：店家、登出、吐司與付款開關都換成假的
vi.mock('../../store/StoreContext', () => ({ useStore: () => ({ myShop: { id: 'shop-1' }, signOutBuyer: async () => {} }) }));
vi.mock('../../components/Toast', () => ({ useToast: () => () => {} }));
const payEnabled = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/payment/usePaymentConfig', () => ({ usePaymentConfig: () => ({ enabled: payEnabled.value, ready: true }) }));

const render = (enabled: boolean) => {
  payEnabled.value = enabled;
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/seller/products']}><SellerTopBar showHome /></MemoryRouter>);
};
const labels = (h: string) => [...h.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]);

describe('SellerTopBar 右上群組：手機（H5）也要有銀行帳號入口', () => {
  it('線上付款開著：我的賣場、物流設定、銀行帳號、我的帳戶、登出，銀行帳號連到 /seller/payout', () => {
    const h = render(true);
    expect(h).toContain('href="/seller/payout"');
    expect(labels(h)).toEqual(['賣家中心工具', '回到買家首頁', '賣家中心功能', '我的賣場', '物流設定', '銀行帳號', '我的帳戶', '登出']);
  });
  it('線上付款關著：跟桌機側欄一樣不出現銀行帳號（維持四顆）', () => {
    const h = render(false);
    expect(h).not.toContain('/seller/payout');
    expect(labels(h)).toEqual(['賣家中心工具', '回到買家首頁', '賣家中心功能', '我的賣場', '物流設定', '我的帳戶', '登出']);
  });
});
