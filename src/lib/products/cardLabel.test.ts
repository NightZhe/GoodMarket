import { describe, expect, it } from 'vitest';
import { cardLabel } from './cardLabel';

const base = {
  title: '【Jy】TOMICA多美 GR Supra',
  price: 850,
  sold: 0,
  shopName: 'Jy',
  location: '花蓮縣',
  soldOut: false,
};

describe('cardLabel：商品卡與列表列的朗讀文字', () => {
  it('依序唸出標題、價格、店名、地點，sold 為 0 時不出現「已售」', () => {
    expect(cardLabel(base)).toBe('【Jy】TOMICA多美 GR Supra，$850，Jy，花蓮縣');
  });

  it('sold > 0 時在價格後、店名前加「已售 N」', () => {
    expect(cardLabel({ ...base, sold: 12 })).toBe('【Jy】TOMICA多美 GR Supra，$850，已售 12，Jy，花蓮縣');
  });

  it('已售數量達萬用「萬」表示，與卡片上看到的一致', () => {
    expect(cardLabel({ ...base, sold: 12000 })).toContain('已售 1.2萬');
  });

  it('價格用 money() 格式：千分位、無小數', () => {
    expect(cardLabel({ ...base, price: 1050 })).toContain('$1,050');
  });

  it('已售完在最後加「，已售完」', () => {
    expect(cardLabel({ ...base, sold: 3, soldOut: true })).toBe(
      '【Jy】TOMICA多美 GR Supra，$850，已售 3，Jy，花蓮縣，已售完',
    );
  });

  it('有原價（高於售價）時，價格後接「原價 $N」，讓朗讀得到刪除線的資訊', () => {
    expect(cardLabel({ ...base, originalPrice: 1000 })).toBe(
      '【Jy】TOMICA多美 GR Supra，$850，原價 $1,000，Jy，花蓮縣',
    );
  });

  it('原價不高於售價時當作沒有原價', () => {
    expect(cardLabel({ ...base, originalPrice: 850 })).not.toContain('原價');
  });

  it('店名還沒載入（undefined）或地點為空時略過該段，不留下空逗號', () => {
    expect(cardLabel({ ...base, shopName: undefined, location: '' })).toBe('【Jy】TOMICA多美 GR Supra，$850');
  });
});
