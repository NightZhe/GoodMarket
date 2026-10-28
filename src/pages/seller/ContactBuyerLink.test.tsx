import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ContactBuyerLink from './ContactBuyerLink';

const html = renderToStaticMarkup(<MemoryRouter><ContactBuyerLink orderId="o-1" orderNo="261028SRPA9T6C" /></MemoryRouter>);

describe('賣家訂單卡「聯絡買家」（AC-M36、§6.4）', () => {
  it('連到 /seller/chat/new?order=<訂單 id>（賣家唯一的發起入口）', () => {
    expect(html).toContain('href="/seller/chat/new?order=o-1"');
  });
  it('可見文字「聯絡買家」，朗讀名稱帶訂單編號（同頁多張訂單才分得出來）', () => {
    expect(html).toContain('>聯絡買家<');
    expect(html).toContain('aria-label="聯絡買家，訂單 261028SRPA9T6C"');
  });
  it('觸控高度 44（min-h-11），圖示只是裝飾', () => {
    expect(html).toContain('min-h-11');
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
  });
});
