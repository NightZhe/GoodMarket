/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CELL_COMPACT, CELL_LABELED, RAIL_CAP_W, RAIL_CENTER, RAIL_PAD, RAIL_PAD_SOLO, RAIL_TOOL_BTN } from './railGeometry';

// 直立軌的幾何數字有兩個地方要用：railLevel.ts 的純函式（算層級）與 CSS／Tailwind class（畫出來）。
// 數字只有一份：railGeometry.ts 是 JS 端的來源，index.css 的 :root 變數是 CSS 端的來源，tabs.tsx 的 class 一律讀變數。
// 這份測試把兩端釘在一起：任何一邊改了數字沒跟著改，這裡就失敗。
// vitest 會把 .css 載入成空字串（?raw 也一樣），所以直接用 fs 讀檔；tsconfig 的 types 只列 vite/client，故檔頭引入 node 型別
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CSS = read('../../index.css');
const TABS = read('./tabs.tsx');
const CAPSULE = read('./GlassCapsule.tsx');

const cssVar = (name: string): number => {
  const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(CSS);
  if (!m) throw new Error(`index.css 找不到 ${name}`);
  return Number(m[1]);
};

describe('直立軌幾何：JS 常數與 index.css 變數同一份數字', () => {
  it('內距、膠囊寬、中心線距離、兩種格高', () => {
    expect(cssVar('--rail-pad')).toBe(RAIL_PAD);
    expect(cssVar('--rail-pad-solo')).toBe(RAIL_PAD_SOLO);
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

describe('X11：工具組只有一顆時是 48×48 圓，多顆維持膠囊', () => {
  it('單顆：44 的鈕上下各 2 內距，剛好 48 高（＝寬）；多顆內距仍是 6', () => {
    expect(RAIL_TOOL_BTN + RAIL_PAD_SOLO * 2).toBe(RAIL_CAP_W);
    expect(RAIL_PAD).toBe(6);
  });

  it('CSS：單顆修飾 class 把內距換成 --rail-pad-solo，圓角取寬的一半（高＝寬時就是正圓）', () => {
    const rule = /\.glass-capsule--solo\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(rule).toContain('padding: var(--rail-pad-solo) 0');
    expect(rule).toContain('border-radius: 50%');
  });

  it('元件：只有一個子項時才掛 glass-capsule--solo', () => {
    expect(CAPSULE).toMatch(/Children\.toArray\(children\)\.length === 1/);
    expect(CAPSULE).toContain('glass-capsule--solo');
  });
});

describe('X11：軌頂與系統島的淨距 ≥ 12（design-spec §3.2：狀態區底邊＋12）', () => {
  const MIN_GAP = 12;
  // 各姿態「系統 UI 最下緣（含島下方灰點）」的實測值，來源 decisions 第七-3 節（小q 第二輪逐像素量測）。
  // null＝該姿態在軌欄頂端沒有系統 UI，不適用淨距
  const DOT_BOTTOM: ReadonlyArray<readonly [rail: string | null, label: string, dotBottom: number | null]> = [
    [null, '內橫', 98.3],
    ['outer-portrait', '外直', 150.7],
    ['outer-landscape-primary', '外橫 primary（相機底）', 66],
    ['outer-landscape-secondary', '外橫 secondary', null],
  ];

  const statusEndOf = (rail: string | null): number => {
    const sel = rail === null ? ':root' : `html\\[data-rail='${rail}'\\]`;
    const rule = new RegExp(`${sel}\\s*\\{[^}]*?--sys-status-end:\\s*(\\d+)px`).exec(CSS);
    if (!rule) throw new Error(`index.css 找不到 ${rail ?? ':root'} 的 --sys-status-end`);
    return Number(rule[1]);
  };
  const railTopGap = (): number => {
    const m = /--rail-top:\s*calc\(max\(env\(safe-area-inset-top\),\s*var\(--sys-status-end\)\)\s*\+\s*(\d+)px\)/.exec(CSS);
    if (!m) throw new Error('index.css 的 --rail-top 不是「max(安全區, --sys-status-end) + N」的形狀');
    return Number(m[1]);
  };

  it('--rail-top ＝ max(安全區上緣, --sys-status-end) ＋ 12', () => {
    expect(railTopGap()).toBe(MIN_GAP);
  });

  it.each(DOT_BOTTOM.filter(([, , dot]) => dot !== null))('%# data-rail=%s（%s）：軌頂 − 灰點底 %f ≥ 12', (rail, _label, dot) => {
    expect(statusEndOf(rail) + railTopGap() - (dot as number)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it('外橫 secondary：欄頂沒有系統 UI，狀態區底 0、軌頂貼頂 12', () => {
    expect(statusEndOf('outer-landscape-secondary')).toBe(0);
    expect(statusEndOf('outer-landscape-secondary') + railTopGap()).toBe(MIN_GAP);
  });

  it('外直：狀態區底 151（含灰點）→ 軌頂 163', () => {
    expect(statusEndOf('outer-portrait') + railTopGap()).toBe(163);
  });
});
