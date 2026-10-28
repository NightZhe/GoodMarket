/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 底部面板（fold-panel）的外層容器要自己吃左右安全區：側邊姿態時系統欄那一側的 --inset-l／--inset-r 是軌欄寬，
// 面板不能跑進系統欄、也不能被相機蓋住。.fold-panel 自己只在橫向寬 ≥ 760 才靠右讓位，外蓋（466／678 寬）靠的是容器的內距（QA1 B1）。
// 沒有元件渲染測試環境，所以這裡直接讀原始碼把規則釘住，與 railGeometry.test.ts 同一個做法。
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const INSETS = ['pl-(--inset-l)', 'pr-(--inset-r)'];

describe('面板外層容器吃左右安全區（QA1 B1）', () => {
  it('商品頁「選擇規格」面板：role=dialog 那一層有左右內距，不再用 absolute inset-x-0 把面板鋪滿全寬', () => {
    const src = read('../../pages/buyer/ProductDetail.tsx');
    const dialog = src.split('\n').find(l => l.includes('aria-label="選擇規格與數量"'));
    expect(dialog, '找不到規格面板的 dialog 容器').toBeDefined();
    for (const cls of INSETS) expect(dialog, cls).toContain(cls);
    expect(src).not.toMatch(/fold-panel[^"]*absolute inset-x-0/);
  });

  it('SheetShell、QuickEditSheet 的容器本來就吃左右安全區，共用的 .fold-panel 不能把它拆掉', () => {
    for (const file of ['../../components/SheetShell.tsx', '../../pages/seller/QuickEditSheet.tsx']) {
      const src = read(file);
      for (const cls of INSETS) expect(src, `${file} ${cls}`).toContain(cls);
    }
  });

  it('.fold-dialog 的四邊內距各自用 --inset-l／--inset-r 與 safe-area，不分寬度', () => {
    const css = read('../../index.css');
    const rule = /\.fold-dialog\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('var(--inset-r)');
    expect(rule).toContain('var(--inset-l)');
    expect(rule).toContain('env(safe-area-inset-top)');
    expect(rule).toContain('env(safe-area-inset-bottom)');
  });
});
