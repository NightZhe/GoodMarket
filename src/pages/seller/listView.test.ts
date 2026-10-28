import { describe, expect, it } from 'vitest';
import { ordersListView, productsListView } from './listView';

// 我的商品列表區「這一刻該顯示哪一態」（規格 6.1、6.6）。failed ＝ 讀取失敗，或正在重試上一次的失敗。
const base = { loading: false, failed: false, hasProducts: true };

describe('productsListView：我的商品列表區', () => {
  it('載入中就是載入態，不論有沒有舊資料', () => {
    expect(productsListView({ ...base, loading: true, hasProducts: false })).toBe('loading');
    expect(productsListView({ ...base, loading: true })).toBe('loading');
  });

  it('讀不到而且沒有資料：錯誤態，不是空態（AC-P1）', () => {
    expect(productsListView({ ...base, failed: true, hasProducts: false })).toBe('error');
  });

  it('讀不到但畫面已有上次的商品：保留列表，只加「可能不是最新」（AC-P8）', () => {
    expect(productsListView({ ...base, failed: true, hasProducts: true })).toBe('stale');
  });

  it('重試中沒有資料：橫幅留在原位，不得變成空態（AC-P4）', () => {
    // 重試一開始 store 就把 loadError 清成 null，loading 仍是 false、商品仍是空——頁面把「重試中」併進 failed
    expect(productsListView({ loading: false, failed: true, hasProducts: false })).toBe('error');
  });

  it('沒有失敗：正常（含真的 0 件商品的空態，由頁面自己依商品數決定）', () => {
    expect(productsListView(base)).toBe('normal');
    expect(productsListView({ ...base, hasProducts: false })).toBe('normal');
  });
});

describe('ordersListView：訂單管理列表區（規格 6.2）', () => {
  it('還沒讀到訂單（idle、loading）都是載入態，不得先說「沒有訂單」', () => {
    expect(ordersListView('idle')).toBe('loading');
    expect(ordersListView('loading')).toBe('loading');
  });

  it('讀不到：錯誤態；讀到了（含 0 筆）：交給頁面畫列表或空態', () => {
    expect(ordersListView('error')).toBe('error');
    expect(ordersListView('ready')).toBe('ready');
  });
});
