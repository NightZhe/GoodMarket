import { describe, expect, it } from 'vitest';
import {
  PRICE_REQUIRED_MSG, REQUIRED_MSG, STOCK_REQUIRED_MSG, quickPriceError, quickStockError, variantErrors,
} from './variants';

const row = (p: Partial<{ name: string; price: string; original: string; stock: string }> = {}) =>
  ({ name: '標準款', price: '1699', original: '', stock: '3', ...p });

describe('variantErrors：沿用既有規則', () => {
  it('名稱、售價、庫存都合法時沒有錯誤', () => {
    expect(variantErrors([row()])).toEqual([]);
  });

  it('名稱空白、售價 0、庫存空白都算沒填', () => {
    const msg = REQUIRED_MSG;
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

describe('REQUIRED_MSG：文案與行為一致', () => {
  it('庫存可以是 0，文案不能再說庫存要大於 0', () => {
    expect(variantErrors([row({ stock: '0' })])).toEqual([]);
    expect(REQUIRED_MSG).toBe('每個規格都要填名稱、大於 0 的售價，以及 0 以上的庫存');
  });
});

describe('quickPriceError：快改單一規格的售價檢查', () => {
  it('空白、0、非數字都算沒填', () => {
    expect(quickPriceError('')).toBe(PRICE_REQUIRED_MSG);
    expect(quickPriceError('  ')).toBe(PRICE_REQUIRED_MSG);
    expect(quickPriceError('0')).toBe('請填大於 0 的售價');
    expect(quickPriceError('12a')).toBe(PRICE_REQUIRED_MSG);
    expect(quickPriceError('-5')).toBe(PRICE_REQUIRED_MSG);
  });

  it('上限 499,999：剛好可以，多 1 不行', () => {
    expect(quickPriceError('499999')).toBeNull();
    expect(quickPriceError('500000')).toBe('售價最高 $499,999');
  });

  it('沒有原價（不存在、undefined、0）時只受上限限制', () => {
    expect(quickPriceError('499999')).toBeNull();
    expect(quickPriceError('499999', undefined)).toBeNull();
    expect(quickPriceError('499999', 0)).toBeNull();
    expect(quickPriceError('5', 0)).toBeNull();
  });

  it('有原價時，新售價要低於原價；等於原價也擋', () => {
    expect(quickPriceError('1999', 2000)).toBeNull();
    expect(quickPriceError('2000', 2000)).toBe('售價要低於原價 $2,000。要改原價請到編輯頁');
    expect(quickPriceError('2100', 2000)).toBe('售價要低於原價 $2,000。要改原價請到編輯頁');
  });

  it('訊息帶的是傳進來的原價（千分位）', () => {
    expect(quickPriceError('3000', 2199)).toBe('售價要低於原價 $2,199。要改原價請到編輯頁');
    expect(quickPriceError('499999', 499999)).toBe('售價要低於原價 $499,999。要改原價請到編輯頁');
  });

  it('優先序：必填 → 上限 → 低於原價', () => {
    expect(quickPriceError('', 2000)).toBe(PRICE_REQUIRED_MSG);
    expect(quickPriceError('600000', 2000)).toBe('售價最高 $499,999');
  });
});

describe('quickStockError：快改單一規格的庫存檢查', () => {
  it('0 可以；上限 999,999 可以；多 1 不行', () => {
    expect(quickStockError('0')).toBeNull();
    expect(quickStockError('37')).toBeNull();
    expect(quickStockError('999999')).toBeNull();
    expect(quickStockError('1000000')).toBe('庫存最高 999,999');
  });

  it('空白與非數字', () => {
    expect(quickStockError('')).toBe(STOCK_REQUIRED_MSG);
    expect(quickStockError('abc')).toBe('請填庫存（0 以上的整數）');
    expect(quickStockError('-1')).toBe(STOCK_REQUIRED_MSG);
    expect(quickStockError('1.5')).toBe(STOCK_REQUIRED_MSG);
  });
});
