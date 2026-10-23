import { describe, expect, it } from 'vitest';
import { orderCategories } from './categoryOrder';
import type { Category, CategoryId, Product } from '../../types';

const cat = (id: CategoryId): Category => ({ id, name: id, icon: '' });

let seq = 0;
const product = (categoryId: CategoryId, status: Product['status'] = 'active'): Product => ({
  id: `p${seq++}`,
  shopId: 's',
  title: 't',
  description: '',
  categoryId,
  images: [],
  variants: [],
  sold: 0,
  rating: 0,
  location: '',
  freeShipping: false,
  status,
  createdAt: '2026-01-01',
});

const ids = (cs: Category[]) => cs.map((c) => c.id);

describe('orderCategories：分類依在架商品數排序', () => {
  it('在架商品多的排前面', () => {
    const cats = [cat('women'), cat('men'), cat('beauty')];
    const products = [product('men'), product('men'), product('men'), product('beauty'), product('women'), product('women')];
    expect(ids(orderCategories(cats, products))).toEqual(['men', 'women', 'beauty']);
  });

  it('同數量照傳入的分類順序', () => {
    const cats = [cat('women'), cat('men'), cat('beauty'), cat('3c')];
    const products = [product('3c'), product('beauty'), product('men'), product('women')];
    expect(ids(orderCategories(cats, products))).toEqual(['women', 'men', 'beauty', '3c']);
  });

  it('0 件的分類保留在最後，彼此照傳入順序', () => {
    const cats = [cat('women'), cat('men'), cat('beauty'), cat('3c')];
    const products = [product('beauty'), product('3c'), product('3c')];
    expect(ids(orderCategories(cats, products))).toEqual(['3c', 'beauty', 'women', 'men']);
  });

  it('下架（hidden）商品不計入', () => {
    const cats = [cat('women'), cat('men')];
    const products = [product('women', 'hidden'), product('women', 'hidden'), product('women', 'hidden'), product('men')];
    expect(ids(orderCategories(cats, products))).toEqual(['men', 'women']);
  });

  it('不改動傳入的陣列', () => {
    const cats = [cat('women'), cat('men')];
    const products = [product('men')];
    orderCategories(cats, products);
    expect(ids(cats)).toEqual(['women', 'men']);
  });
});
