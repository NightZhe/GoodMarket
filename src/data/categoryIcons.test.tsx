import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATEGORIES } from './seed';
import { CATEGORY_ICONS, CategoryIcon } from './categoryIcons';

describe('CategoryIcon：D6 單色線條、裝飾用', () => {
  it('CATEGORIES 的每個分類都有圖示', () => {
    for (const c of CATEGORIES) expect(CATEGORY_ICONS[c.id], c.id).toBeDefined();
  });

  it.each(CATEGORIES.map((c) => c.id))('%s：svg、aria-hidden、只用 currentColor、帶入尺寸與線寬', (id) => {
    const html = renderToStaticMarkup(<CategoryIcon id={id} size={20} strokeWidth={2} className="x" />);
    expect(html).toMatch(/^<svg /);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('width="20"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toMatch(/class="[^"]*\bx\b/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|hsl/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('預設 18pt、線寬 1.7', () => {
    const html = renderToStaticMarkup(<CategoryIcon id="women" />);
    expect(html).toContain('width="18"');
    expect(html).toContain('stroke-width="1.7"');
  });
});
