import { describe, expect, it } from 'vitest';
import { popoverAt, syncPopover } from './popoverState';

describe('syncPopover：換頁就關，回到原頁也不會自己重開（B1）', () => {
  it('同一頁不動，回傳原物件', () => {
    const s = { open: true, path: '/seller/orders' };
    expect(syncPopover(s, '/seller/orders')).toBe(s);
  });
  it('換頁後是關閉狀態', () => {
    expect(syncPopover({ open: true, path: '/seller/orders' }, '/seller/products')).toEqual({ open: false, path: '/seller/products' });
  });
  it('打開 → 換到別頁 → 回到原頁：仍是關閉', () => {
    const opened = { open: true, path: '/seller/orders' };
    const away = syncPopover(opened, '/seller/products');
    const back = syncPopover(away, '/seller/orders');
    expect(back.open).toBe(false);
  });
  it('預設狀態是關閉', () => {
    expect(popoverAt('/x').open).toBe(false);
  });
});
