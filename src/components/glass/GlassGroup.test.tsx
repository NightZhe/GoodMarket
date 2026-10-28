import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GlassGroup, type GlassGroupItem } from './GlassGroup';

const items: GlassGroupItem[] = [
  { key: 'a', label: '我的賣場', icon: <i />, to: '/shop/s1' },
  { key: 'b', label: '物流設定', icon: <i />, to: '/seller/logistics' },
  { key: 'c', label: '登出', icon: <i />, onClick: () => undefined, hasPopup: 'dialog', separatorBefore: true },
];
const html = (forceCollapse = false) => renderToStaticMarkup(
  <MemoryRouter><GlassGroup label="賣家中心功能" items={items} forceCollapse={forceCollapse} /></MemoryRouter>,
);

describe('GlassGroup：放得下就整組露出（量不到寬度時先當放得下）', () => {
  it('每顆圖示鈕都有朗讀名稱與 hover 提示，連結帶正確目的地', () => {
    const h = html();
    expect(h).toContain('aria-label="我的賣場"');
    expect(h).toContain('href="/shop/s1"');
    expect(h).toContain('aria-label="登出"');
    expect(h).toContain('title="物流設定"');
  });
  it('登出前有分隔槽（aria-hidden），登出鈕標示會開對話框', () => {
    const h = html();
    expect(h).toContain('glass-group-sep');
    expect(h).toMatch(/<span aria-hidden="true" class="glass-group-sep">/);
    expect(h).toMatch(/aria-haspopup="dialog"[^>]*aria-label="登出"|aria-label="登出"[^>]*aria-haspopup="dialog"/);
  });
  it('整組在有名稱的 group 裡，沒有「更多」鈕', () => {
    const h = html();
    expect(h).toContain('role="group" aria-label="賣家中心功能"');
    expect(h).not.toContain('aria-label="更多"');
  });
});

describe('GlassGroup：收合成「⋯」＋浮層', () => {
  it('「⋯」鈕有名稱、aria-expanded=false、aria-controls 指向浮層', () => {
    const h = html(true);
    expect(h).toContain('aria-label="更多"');
    expect(h).toContain('aria-expanded="false"');
    const id = /aria-controls="([^"]+)"/.exec(h)?.[1];
    expect(id).toBeTruthy();
    expect(h).toContain(`id="${id}"`);
  });
  it('浮層收起時不可聚焦（inert）、不外露；各列文字與列高 ≥ 48 的 class 都在', () => {
    const h = html(true);
    expect(h).toMatch(/class="glass-group-pop[^"]*"/);
    expect(h).toContain('inert');
    expect(h).toContain('min-h-12');
    for (const label of ['我的賣場', '物流設定', '登出']) expect(h).toContain(`>${label}<`);
  });
  it('收合時不再畫整組的圖示格', () => {
    expect(html(true)).not.toContain('class="glass glass-group');
  });
});
