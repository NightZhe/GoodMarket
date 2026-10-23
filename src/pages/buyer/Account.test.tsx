import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SignedOut } from '../../components/account/AccountRows';

const html = (known: boolean) => renderToStaticMarkup(<MemoryRouter><SignedOut known={known} onLogin={() => {}} /></MemoryRouter>);

// AC-7：未登入進「我的」不是空白頁
describe('我的（未登入）', () => {
  it('有登入列、說明，和購物／開店／其他三組', () => {
    const h = html(true);
    expect(h).toContain('aria-label="登入或註冊"');
    expect(h).toContain('用 Apple、Google 或手機號碼登入。登入後才能加入購物車、下單和寫評價。');
    for (const w of ['購物', '開店', '其他', '我的訂單', '購物車', '地址', '賣家中心', '隱私政策']) expect(h, w).toContain(w);
  });
  it('登入列與我的訂單、購物車、地址是按鈕（先登入）；賣家中心、隱私政策是連結（不用登入）', () => {
    const h = html(true);
    expect(h.match(/<button/g)?.length).toBe(4);
    expect(h).toContain('href="/seller"');
    expect(h).toContain('href="/privacy"');
    expect(h).not.toContain('href="/orders"');
  });
  it('登入狀態還不知道：頭像位置是灰塊、沒有登入鈕；三個入口直接是連結，由目的頁處理登入', () => {
    const h = html(false);
    expect(h).toContain('aria-busy="true"');
    expect(h).not.toContain('登入或註冊');
    expect(h).not.toContain('<button');
    for (const to of ['/orders', '/cart', '/account/addresses']) expect(h).toContain(`href="${to}"`);
  });
});
