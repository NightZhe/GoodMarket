import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LogisticsEntryRow, ReturnPrompt } from './ReturnPrompt';

const html = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('賣場總覽的退貨地址提示卡（D18、AC-L34）', () => {
  it('標題逐字、連到物流設定、說明句採精簡版', () => {
    const h = html(<ReturnPrompt />);
    expect(h).toContain('尚未設定退貨地址');
    expect(h).toContain('href="/seller/logistics"');
    expect(h).toContain('買家要退貨時，會在訂單上看到你設定的退貨門市或地址。');
  });
  it('不可關閉：沒有任何按鈕', () => {
    expect(html(<ReturnPrompt />)).not.toContain('<button');
  });
  it('188 寬藏起裝飾圖示（文字才有空間）', () => {
    expect(html(<ReturnPrompt />)).toContain('max-[239px]:hidden');
  });
});

describe('手機常駐「物流設定」入口列', () => {
  it('連到物流設定、只在手機顯示（桌機有側欄）', () => {
    const h = html(<LogisticsEntryRow />);
    expect(h).toContain('href="/seller/logistics"');
    expect(h).toContain('物流設定');
    expect(h).toContain('設定買家退貨要寄到哪裡');
    expect(h).toContain('md:hidden');
  });
});
