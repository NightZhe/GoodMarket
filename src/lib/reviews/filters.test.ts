import { describe, expect, it } from 'vitest';
import {
  NO_FILTER, isFiltering, needsNormalize, parseRatingParam, parseSellerTab, readSellerState,
  resolveShopId, toggleRating, togglePhotos, writeSellerState,
} from './filters';

describe('買家篩選', () => {
  it('星等單選，再點一次取消', () => {
    const one = toggleRating(NO_FILTER, 1);
    expect(one.rating).toBe(1);
    expect(toggleRating(one, 5).rating).toBe(5);
    expect(toggleRating(one, 1).rating).toBeNull();
  });

  it('「附照片」可以跟星等同時選', () => {
    const f = togglePhotos(toggleRating(NO_FILTER, 1));
    expect(f).toEqual({ rating: 1, photos: true });
    expect(isFiltering(f)).toBe(true);
    expect(isFiltering(NO_FILTER)).toBe(false);
  });
});

describe('賣家網址參數', () => {
  it('合法值讀得出來', () => {
    expect(readSellerState(new URLSearchParams('tab=unreplied&rating=1'))).toEqual({ tab: 'unreplied', rating: 1 });
  });

  it('沒有參數＝全部／全部', () => {
    expect(readSellerState(new URLSearchParams(''))).toEqual({ tab: 'all', rating: null });
  });

  it.each(['0', '6', '3.5', '03', 'abc', '', '-1', '1 '])('不合法的星等 %j 退回全部', (raw) => {
    expect(parseRatingParam(raw)).toBeNull();
  });

  it('不合法的分頁退回全部', () => {
    expect(parseSellerTab('replied')).toBe('all');
    expect(parseSellerTab(null)).toBe('all');
  });

  it('預設值不寫進網址，其他參數保留', () => {
    const base = new URLSearchParams('foo=1&tab=unreplied&rating=2');
    expect(writeSellerState(base, { tab: 'all', rating: null }).toString()).toBe('foo=1');
    expect(writeSellerState(new URLSearchParams(), { tab: 'unreplied', rating: 1 }).toString()).toBe('tab=unreplied&rating=1');
  });

  it('網址不合法時要求改正；合法時不動', () => {
    expect(needsNormalize(new URLSearchParams('tab=x&rating=9'))).toBe(true);
    expect(needsNormalize(new URLSearchParams('tab=all'))).toBe(true);
    expect(needsNormalize(new URLSearchParams('tab=unreplied&rating=3'))).toBe(false);
    expect(needsNormalize(new URLSearchParams(''))).toBe(false);
  });
});

describe('resolveShopId（總覽頁的賣場評價分頁）', () => {
  it('商品還在架上：用商品目前的店', () => {
    expect(resolveShopId({ shopId: 'live' }, { shop_id: 'snap' })).toBe('live');
  });

  it('商品下架或刪除、匿名讀不到：用評價快照裡的店', () => {
    expect(resolveShopId(undefined, { shop_id: 'snap' })).toBe('snap');
    expect(resolveShopId(null, { shop_id: 'snap' })).toBe('snap');
  });

  it('兩邊都沒有（商品不存在、也沒有評價）：沒有分頁', () => {
    expect(resolveShopId(undefined, null)).toBeNull();
    expect(resolveShopId(undefined, undefined)).toBeNull();
  });
});
