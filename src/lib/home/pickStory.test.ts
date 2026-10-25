import { describe, expect, it } from 'vitest';
import { pickStory } from './pickStory';
import type { Category, CategoryId, Product } from '../../types';

const CATS: Category[] = [
  { id: 'games', name: '電玩遊戲', icon: '' },
  { id: 'toys', name: '玩具收藏', icon: '' },
  { id: 'home', name: '居家生活', icon: '' },
];

const NOW = Date.parse('2026-10-23T12:00:00Z');
const HOUR = 60 * 60 * 1000;
/** 距離 NOW 幾小時前的 ISO 時間 */
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

let seq = 0;
const product = (categoryId: CategoryId, hoursAgo: number, extra: Partial<Product> = {}): Product => ({
  id: `p${seq++}`,
  shopId: 's',
  title: `商品 ${seq}`,
  description: '',
  categoryId,
  images: [`https://img.test/${seq}.jpg`],
  variants: [],
  sold: 0,
  rating: 0,
  location: '',
  freeShipping: false,
  status: 'active',
  createdAt: ago(hoursAgo),
  ...extra,
});

describe('pickStory：首頁故事卡（D3，design-final §4.3）', () => {
  it('AC-8：某分類近 7 天 ≥3 件 → 選它，標題「{分類名}到貨」，主圖是該分類最新一件的主圖', () => {
    const newest = product('toys', 1, { images: ['https://img.test/newest.jpg'] });
    const products = [product('toys', 30), newest, product('toys', 100), product('games', 2)];

    const story = pickStory(products, CATS, NOW);

    expect(story).toEqual({
      categoryId: 'toys',
      categoryName: '玩具收藏',
      title: '玩具收藏到貨',
      eyebrow: '近 7 天上新',
      image: 'https://img.test/newest.jpg',
      latest: newest,
      newCount: 3,
    });
  });

  it('AC-9：最多的分類近 7 天也只有 2 件 → 不顯示', () => {
    const products = [product('toys', 1), product('toys', 2), product('games', 3), product('home', 4)];
    expect(pickStory(products, CATS, NOW)).toBeNull();
  });

  it('AC-9：沒有任何近 7 天商品 → 不顯示', () => {
    const products = [product('toys', 7 * 24 + 1), product('toys', 200), product('toys', 300)];
    expect(pickStory(products, CATS, NOW)).toBeNull();
    expect(pickStory([], CATS, NOW)).toBeNull();
  });

  it('近 7 天＝往前 7×24 小時：剛好 168 小時算，超過 1 毫秒不算', () => {
    const edge = product('toys', 7 * 24);
    const outside = { ...product('toys', 7 * 24), createdAt: new Date(NOW - 7 * 24 * HOUR - 1).toISOString() };
    expect(pickStory([product('toys', 1), product('toys', 2), edge], CATS, NOW)?.newCount).toBe(3);
    expect(pickStory([product('toys', 1), product('toys', 2), outside], CATS, NOW)).toBeNull();
  });

  it('AC-10：近 7 天同數 → 在架總數多的分類勝出', () => {
    const products = [
      product('games', 1), product('games', 2), product('games', 3),
      product('toys', 1), product('toys', 2), product('toys', 3),
      product('toys', 500), // 舊品，只算在架總數
    ];
    expect(pickStory(products, CATS, NOW)?.categoryId).toBe('toys');
  });

  it('AC-10：近 7 天與在架總數都同 → 照 categories 順序', () => {
    const products = [
      product('toys', 1), product('toys', 2), product('toys', 3),
      product('games', 4), product('games', 5), product('games', 6),
    ];
    expect(pickStory(products, CATS, NOW)?.categoryId).toBe('games');
    expect(pickStory(products, [CATS[1], CATS[0], CATS[2]], NOW)?.categoryId).toBe('toys');
  });

  it('下架（hidden）的商品不計入近 7 天件數，也不能當主圖', () => {
    const hiddenNewest = product('toys', 1, { status: 'hidden', images: ['https://img.test/hidden.jpg'] });
    const products = [hiddenNewest, product('toys', 2), product('toys', 3)];
    expect(pickStory(products, CATS, NOW)).toBeNull();

    const withThird = [...products, product('toys', 4)];
    const story = pickStory(withThird, CATS, NOW);
    expect(story?.newCount).toBe(3);
    expect(story?.image).not.toBe('https://img.test/hidden.jpg');
  });

  it('下架的商品也不算在架總數（同數比較時）', () => {
    const products = [
      product('games', 1), product('games', 2), product('games', 3),
      product('toys', 1), product('toys', 2), product('toys', 3),
      product('toys', 500, { status: 'hidden' }),
    ];
    expect(pickStory(products, CATS, NOW)?.categoryId).toBe('games');
  });

  it('最新一件沒有圖 → 主圖與白條都改用下一件有圖的；件數仍算 3', () => {
    const noImage = product('toys', 1, { images: [] });
    const second = product('toys', 2, { images: ['https://img.test/second.jpg'] });
    const story = pickStory([noImage, second, product('toys', 3)], CATS, NOW);
    expect(story?.image).toBe('https://img.test/second.jpg');
    expect(story?.latest).toBe(second);
    expect(story?.newCount).toBe(3);
  });

  it('空字串圖片網址視為沒有圖', () => {
    const blank = product('toys', 1, { images: [''] });
    const second = product('toys', 2, { images: ['https://img.test/second.jpg'] });
    expect(pickStory([blank, second, product('toys', 3)], CATS, NOW)?.image).toBe('https://img.test/second.jpg');
  });

  it('該分類近 7 天每一件都沒有圖 → 不顯示', () => {
    const products = [product('toys', 1, { images: [] }), product('toys', 2, { images: [] }), product('toys', 3, { images: [] })];
    expect(pickStory(products, CATS, NOW)).toBeNull();
  });

  it('同一個 now 算多次結果一致，且不受商品陣列順序影響（重讀後順序可能不同）', () => {
    const a = product('toys', 1, { id: 'a', images: ['https://img.test/a.jpg'] });
    const b = product('toys', 1, { id: 'b', images: ['https://img.test/b.jpg'] }); // 與 a 同一刻上架
    const products = [a, b, product('toys', 5), product('games', 2), product('games', 3), product('games', 4)];

    const first = pickStory(products, CATS, NOW);
    expect(pickStory(products, CATS, NOW)).toEqual(first);
    expect(pickStory([...products].reverse(), CATS, NOW)).toEqual(first);
    expect(first?.categoryId).toBe('games');
  });

  it('最新兩件同一刻上架 → 不論陣列順序都挑同一件當主圖', () => {
    const a = product('toys', 1, { id: 'a', images: ['https://img.test/a.jpg'] });
    const b = product('toys', 1, { id: 'b', images: ['https://img.test/b.jpg'] });
    const products = [a, b, product('toys', 5)];
    expect(pickStory(products, CATS, NOW)?.image).toBe(pickStory([b, a, products[2]], CATS, NOW)?.image);
  });
});
