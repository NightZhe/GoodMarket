import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ReviewsEntryRow, UnreadMessagesCard } from './dashboardCards';

const html = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('賣場總覽「你有 N 則未讀訊息」提示卡（AC-M20）', () => {
  it('6 則：文字「你有 6 則未讀訊息」，整張是連到 /seller/chat 的連結', () => {
    const h = html(<UnreadMessagesCard messages={6} />);
    expect(h).toContain('你有 6 則未讀訊息');
    expect(h).toMatch(/^<a [^>]*href="\/seller\/chat"/);
  });

  it('0 則：不顯示（不是顯示「0 則」）', () => {
    expect(html(<UnreadMessagesCard messages={0} />)).toBe('');
  });

  it('超過 99 則顯示 99+；數字壞掉（NaN、負數）當 0 不顯示', () => {
    expect(html(<UnreadMessagesCard messages={250} />)).toContain('你有 99+ 則未讀訊息');
    expect(html(<UnreadMessagesCard messages={Number.NaN} />)).toBe('');
    expect(html(<UnreadMessagesCard messages={-3} />)).toBe('');
  });

  it('圖示只是裝飾（aria-hidden），整張卡的名稱就是那句文字', () => {
    const h = html(<UnreadMessagesCard messages={6} />);
    expect(h).not.toContain('aria-label');
    expect(h.match(/<svg [^>]*aria-hidden="true"/g)?.length).toBe(2);
  });
});

describe('賣場總覽「評價管理」入口列（評價退出底欄後從這裡進）', () => {
  it('連到 /seller/reviews，有名稱與副字', () => {
    const h = html(<ReviewsEntryRow />);
    expect(h).toMatch(/^<a [^>]*href="\/seller\/reviews"/);
    expect(h).toContain('評價管理');
    expect(h).toContain('查看與回覆買家的評價');
  });

  it('桌機有側欄所以隱藏（md:hidden），點擊範圍高度至少 48', () => {
    const h = html(<ReviewsEntryRow />);
    expect(h).toContain('md:hidden');
    expect(h).toContain('min-h-12');
  });
});
