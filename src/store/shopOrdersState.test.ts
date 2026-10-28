import { describe, expect, it } from 'vitest';
import { nextShopOrdersState } from './shopOrdersState';

// 賣家訂單讀取狀態（規格 6.3）：讓畫面分得出「還在讀」「讀到 0 筆」「讀不到」。
describe('nextShopOrdersState', () => {
  it('第一次讀取：idle → loading → ready', () => {
    expect(nextShopOrdersState('idle', 'start')).toBe('loading');
    expect(nextShopOrdersState('loading', 'ok')).toBe('ready');
  });

  it('還沒成功過就失敗：error', () => {
    expect(nextShopOrdersState('loading', 'fail')).toBe('error');
    expect(nextShopOrdersState('idle', 'fail')).toBe('error');
  });

  it('從 error 重試：結果回來前保持 error（畫面留在「重試中…」，不跳去載入態）', () => {
    expect(nextShopOrdersState('error', 'start')).toBe('error');
    expect(nextShopOrdersState('error', 'fail')).toBe('error');
    expect(nextShopOrdersState('error', 'ok')).toBe('ready');
  });

  it('已讀到過之後的重讀：開始不回到 loading，失敗維持 ready（背景重讀靜默）', () => {
    expect(nextShopOrdersState('ready', 'start')).toBe('ready');
    expect(nextShopOrdersState('ready', 'fail')).toBe('ready');
    expect(nextShopOrdersState('ready', 'ok')).toBe('ready');
  });

  it('登出、換帳號：回 idle，下一家店從 loading 開始', () => {
    for (const s of ['idle', 'loading', 'ready', 'error'] as const) expect(nextShopOrdersState(s, 'reset')).toBe('idle');
    expect(nextShopOrdersState(nextShopOrdersState('ready', 'reset'), 'start')).toBe('loading');
  });
});
