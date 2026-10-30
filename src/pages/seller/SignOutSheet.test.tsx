import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SignOutSheet from './SignOutSheet';

const html = renderToStaticMarkup(<SignOutSheet onConfirm={async () => true} onClose={() => undefined} restoreFocus={() => undefined} />);

describe('SignOutSheet：登出確認面板（spec 4.3、design.md §4／§9）', () => {
  it('是 alertdialog、modal，標題與說明用 labelledby／describedby 接起來', () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${labelled}"`);
    expect(html).toContain(`id="${described}"`);
  });
  it('文案：標題、說明、登出（上）、取消（下）', () => {
    expect(html).toContain('要登出嗎？');
    expect(html).toContain('只會登出這台裝置，買家端也會一起登出。商品、訂單都還在，下次登入就回來。');
    expect(html.indexOf('>登出<')).toBeLessThan(html.indexOf('>取消<'));
  });
  it('兩顆按鈕高度 ≥ 56（min-h-14），登出用 error-text、取消用 brand', () => {
    expect(html.match(/min-h-14/g)?.length).toBe(2);
    expect(html).toContain('text-error-text');
    expect(html).toContain('text-brand');
  });
  it('容器用 fold-dialog／fold-panel（避開中線帶）、面板動畫 animate-sheet（減少動態時 index.css 改淡入）', () => {
    expect(html).toContain('fold-dialog');
    expect(html).toContain('fold-panel');
    expect(html).toContain('animate-sheet');
  });
});
