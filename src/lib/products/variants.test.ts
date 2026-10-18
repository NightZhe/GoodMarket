import { describe, expect, it } from 'vitest';
import { variantErrors } from './variants';

const row = (p: Partial<{ name: string; price: string; original: string; stock: string }> = {}) =>
  ({ name: '標準款', price: '1699', original: '', stock: '3', ...p });

describe('variantErrors：沿用既有規則', () => {
  it('名稱、售價、庫存都合法時沒有錯誤', () => {
    expect(variantErrors([row()])).toEqual([]);
  });

  it('名稱空白、售價 0、庫存空白都算沒填', () => {
    const msg = '每個規格都要填名稱、大於 0 的售價與庫存';
    expect(variantErrors([row({ name: '  ' })])).toEqual([msg]);
    expect(variantErrors([row({ price: '0' })])).toEqual([msg]);
    expect(variantErrors([row({ stock: '' })])).toEqual([msg]);
  });

  it('原價填了就要高於同一列的售價', () => {
    expect(variantErrors([row({ original: '1699' })])).toEqual(['原價要高於同一列的售價，否則請留空']);
    expect(variantErrors([row({ original: '2000' })])).toEqual([]);
  });
});

describe('variantErrors：上限', () => {
  it('售價最高 499,999；剛好等於上限可以', () => {
    expect(variantErrors([row({ price: '499999' })])).toEqual([]);
    expect(variantErrors([row({ price: '500000' })])).toEqual(['售價最高 $499,999']);
  });

  it('原價最高 499,999；剛好等於上限可以', () => {
    expect(variantErrors([row({ price: '100', original: '499999' })])).toEqual([]);
    expect(variantErrors([row({ price: '100', original: '500000' })])).toEqual(['原價最高 $499,999']);
  });

  it('庫存最高 999,999；剛好等於上限可以', () => {
    expect(variantErrors([row({ stock: '999999' })])).toEqual([]);
    expect(variantErrors([row({ stock: '1000000' })])).toEqual(['庫存最高 999,999']);
  });

  it('售價超過上限時，原價只要比售價高就不再重複報「原價要高於售價」', () => {
    expect(variantErrors([row({ price: '600000', original: '700000' })]))
      .toEqual(['售價最高 $499,999', '原價最高 $499,999']);
  });

  it('多列各有問題時，同一種訊息只出現一次', () => {
    expect(variantErrors([row({ price: '500000' }), row({ price: '600000' }), row({ stock: '1000000' })]))
      .toEqual(['售價最高 $499,999', '庫存最高 999,999']);
  });
});
