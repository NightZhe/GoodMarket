/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 每個有懸浮托盤的頁面，內容底部預留都要跟托盤實測高度走（文字放大到 200% 托盤換行變高時最後一列才不被蓋住，QA1 B2）。
// 沒有元件渲染測試環境，所以這裡直接讀原始碼釘住接法，與 sheetInsets.test.ts 同一個做法。
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const PAGES: { name: string; file: string; reporter: RegExp }[] = [
  { name: '評價表單（送出托盤）', file: '../../pages/buyer/ReviewForm.tsx', reporter: /onTrayHeight|useTrayHeightReport/ },
  { name: '下單被擋（重新購買托盤）', file: '../../components/checkout/CheckoutRejected.tsx', reporter: /useTrayHeightReport/ },
  { name: '新增／編輯商品（儲存托盤）', file: '../../pages/seller/ProductForm.tsx', reporter: /onHeight=\{setTrayHeight\}/ },
  { name: '購物車骨架', file: '../../pages/buyer/Cart.tsx', reporter: /useTrayHeightReport/ },
  { name: '商品頁骨架', file: '../../pages/buyer/BuyerLayout.tsx', reporter: /onHeight=\{setTrayHeight\}/ },
];

describe('托盤變高時內容底部預留跟著走', () => {
  for (const { name, file, reporter } of PAGES) {
    it(`${name}：根元素用 --tray-reserve，不再直接吃固定的 --tray-clearance／--stack-clearance`, () => {
      const src = read(file);
      expect(src, 'pb 要用 --tray-reserve').toMatch(/pb-(\(--tray-reserve\)|\[calc\(var\(--tray-reserve\))/);
      expect(src, 'inline style 要由 trayReserveStyle 提供').toContain('trayReserveStyle(');
      expect(src, '要回報托盤高度').toMatch(reporter);
      expect(src).not.toMatch(/pb-\(--(tray|stack)-clearance\)/);
      expect(src).not.toMatch(/pb-\[calc\(var\(--(tray|stack)-clearance\)/);
    });
  }

  it('CartSkeleton 與 CartView 各自有一份托盤高度（骨架的托盤也會換行變高，載入完成時底部不跳）', () => {
    const src = read('../../pages/buyer/Cart.tsx');
    expect(src.match(/useTrayHeightReport\(/g)?.length).toBe(2);
    expect(src.match(/trayReserveStyle\(/g)?.length).toBe(2);
  });
});
