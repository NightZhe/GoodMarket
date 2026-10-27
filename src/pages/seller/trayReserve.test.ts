import { describe, expect, it } from 'vitest';
import { trayReserve } from './trayReserve';

describe('trayReserve：頁面底部為懸浮托盤預留的高度（CSS 字串）', () => {
  it('水平姿態托盤疊在膠囊上：以 --stack-clearance 為底，托盤比標準 64 高多少就多留多少', () => {
    expect(trayReserve(true, 94)).toBe('calc(var(--stack-clearance) + max(0px, 94px - var(--tray-h)))');
  });

  it('側邊姿態沒有膠囊：以 --tray-clearance 為底', () => {
    expect(trayReserve(false, 150)).toBe('calc(var(--tray-clearance) + max(0px, 150px - var(--tray-h)))');
  });

  it('還沒量到（0）或托盤比標準矮：多出的部分在 CSS 端夾到 0，不會變成負的', () => {
    expect(trayReserve(true, 0)).toContain('max(0px, 0px - var(--tray-h))');
  });
});
