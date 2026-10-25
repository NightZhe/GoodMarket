import { describe, expect, it } from 'vitest';
import { publicUrl } from './publicUrl';

describe('publicUrl', () => {
  it('組成正式站 hash 路由網址', () => {
    expect(publicUrl('/product/p1')).toBe('https://nightzhe.github.io/GoodMarket/#/product/p1');
    expect(publicUrl('/shop/s1')).toBe('https://nightzhe.github.io/GoodMarket/#/shop/s1');
  });
  it('沒有開頭斜線也補上', () => {
    expect(publicUrl('shop/s1')).toBe('https://nightzhe.github.io/GoodMarket/#/shop/s1');
  });
});
