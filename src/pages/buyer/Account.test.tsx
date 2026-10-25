import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DeleteNavRow, SignedOut } from '../../components/account/AccountRows';

const html = (known: boolean) => renderToStaticMarkup(<MemoryRouter><SignedOut known={known} onLogin={() => {}} /></MemoryRouter>);

// AC-7：未登入進「我的」不是空白頁
describe('我的（未登入）', () => {
  it('有登入列、說明，和購物／開店／其他三組', () => {
    const h = html(true);
    expect(h).toContain('aria-label="登入或註冊"');
    expect(h).toContain('用 Apple、Google 或手機號碼登入。登入後才能加入購物車、下單和寫評價。');
    for (const w of ['購物', '開店', '其他', '我的訂單', '購物車', '地址', '賣家中心', '隱私政策', '已封鎖的店家']) expect(h, w).toContain(w);
  });
  it('登入列與我的訂單、購物車、地址是按鈕（先登入）；賣家中心、隱私政策、已封鎖的店家是連結（不用登入）', () => {
    const h = html(true);
    expect(h.match(/<button/g)?.length).toBe(4);
    expect(h).toContain('href="/seller"');
    expect(h).toContain('href="/privacy"');
    expect(h).toContain('href="/account/blocked"');
    expect(h).not.toContain('刪除帳號');
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

// AC-D1／D4：登入後「我的帳戶」最後一列；處理中改雙行
describe('我的（已登入）：刪除帳號列', () => {
  const row = (pending: boolean, due = '') => renderToStaticMarkup(<MemoryRouter><ul><DeleteNavRow pending={pending} dueDate={due} /></ul></MemoryRouter>);
  it('沒有申請或讀不到狀態：只有「刪除帳號」連到申請頁，沒有錯誤字樣', () => {
    const h = row(false);
    expect(h).toContain('href="/account/delete"');
    expect(h).toContain('刪除帳號');
    expect(h).not.toContain('處理中');
    expect(h).not.toContain('預計');
  });
  it('處理中：兩行字，日期畫面版 2026/11/04、讀屏版 2026 年 11 月 4 日', () => {
    const h = row(true, '2026-11-04');
    expect(h).toContain('href="/account/delete"');
    expect(h).toContain('刪除申請處理中');
    expect(h).toContain('aria-hidden="true" class="block text-footnote text-muted">預計 2026/11/04 前完成');
    expect(h).toContain('預計 2026 年 11 月 4 日前完成');
  });
  it('處理中但日期壞掉：只顯示「刪除申請處理中」，不顯示殘缺的日期行', () => {
    const h = row(true, 'oops');
    expect(h).toContain('刪除申請處理中');
    expect(h).not.toContain('預計');
  });
});
