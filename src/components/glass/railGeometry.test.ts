/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CELL_COMPACT, CELL_LABELED, RAIL_CAP_W, RAIL_CENTER, RAIL_PAD } from './railGeometry';

// 直立軌的幾何數字有兩個地方要用：railLevel.ts 的純函式（算層級）與 CSS／Tailwind class（畫出來）。
// 數字只有一份：railGeometry.ts 是 JS 端的來源，index.css 的 :root 變數是 CSS 端的來源，tabs.tsx 的 class 一律讀變數。
// 這份測試把兩端釘在一起：任何一邊改了數字沒跟著改，這裡就失敗。
// vitest 會把 .css 載入成空字串（?raw 也一樣），所以直接用 fs 讀檔；tsconfig 的 types 只列 vite/client，故檔頭引入 node 型別
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CSS = read('../../index.css');
const TABS = read('./tabs.tsx');

const cssVar = (name: string): number => {
  const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(CSS);
  if (!m) throw new Error(`index.css 找不到 ${name}`);
  return Number(m[1]);
};

describe('直立軌幾何：JS 常數與 index.css 變數同一份數字', () => {
  it('內距、膠囊寬、中心線距離、兩種格高', () => {
    expect(cssVar('--rail-pad')).toBe(RAIL_PAD);
    expect(cssVar('--rail-cap-w')).toBe(RAIL_CAP_W);
    expect(cssVar('--rail-center')).toBe(RAIL_CENTER);
    expect(cssVar('--cell-h')).toBe(CELL_LABELED);
    expect(cssVar('--cell-h-compact')).toBe(CELL_COMPACT);
  });

  it('軌的膠囊與分頁組內距都讀 --rail-pad，不另寫 6px', () => {
    for (const sel of ['.glass-capsule', '.glass-rail-body']) {
      const rule = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`).exec(CSS)?.[0] ?? '';
      expect(rule, sel).toContain('padding: var(--rail-pad) 0');
    }
  });

  it('X10：膠囊 48 寬、中心線距螢幕邊 48（對齊系統島）；左右姿態都從螢幕邊算起，不用欄寬的一半', () => {
    expect(RAIL_CAP_W).toBe(48);
    expect(RAIL_CENTER).toBe(48);
    for (const side of ['right', 'left']) {
      const rule = new RegExp(`data-bars='side-${side}'\\]\\s*\\.glass-capsule[^{]*\\{[^}]*\\}`).exec(CSS)?.[0] ?? '';
      expect(rule, side).toContain(`${side}: calc(var(--rail-center) - var(--rail-cap-w) / 2)`);
      expect(rule, side).not.toContain('--rail-w');
    }
  });

  it('分頁格（tabs.tsx）的高與寬讀變數，不寫死像素', () => {
    expect(TABS).toContain('h-(--cell-h)');
    expect(TABS).toContain('h-(--cell-h-compact)');
    expect(TABS).toContain('w-(--rail-cap-w)');
    expect(TABS).not.toMatch(/h-\[50px\]|h-11\b|w-14\b/);
  });
});
