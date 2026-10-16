import { describe, expect, it } from 'vitest';
import { formGate, orderCardState, partitionItems } from './status';
import type { MyReviewItem, OrderReviewStatus } from './types';

const item = (id: string, reviewed: boolean): MyReviewItem => ({
  product_id: id, title: id, image: '', variant_names: [], reviewed, review: null,
});
const order = (items: MyReviewItem[], expired = false): OrderReviewStatus => ({
  order_id: 'o', order_no: 'N', completed_at: '2026-10-01T00:00:00Z', deadline_date: '2026-10-31',
  deadline_at: '', expired, items,
});

describe('orderCardState（S-1 a／b／c）', () => {
  it('a. 還有沒評的、在期限內', () => {
    expect(orderCardState(order([item('a', false), item('b', true), item('c', false)])))
      .toEqual({ kind: 'reviewable', deadlineDate: '2026-10-31', unreviewed: 2, total: 3 });
  });

  it('b. 全部評過：就算已過期也是「已評價」', () => {
    expect(orderCardState(order([item('a', true)]))).toEqual({ kind: 'allDone', total: 1 });
    expect(orderCardState(order([item('a', true)], true))).toEqual({ kind: 'allDone', total: 1 });
  });

  it('c. 已過期、還有沒評的', () => {
    expect(orderCardState(order([item('a', true), item('b', false)], true)))
      .toEqual({ kind: 'expired', reviewed: 1, unreviewed: 1 });
    expect(orderCardState(order([item('a', false)], true)))
      .toEqual({ kind: 'expired', reviewed: 0, unreviewed: 1 });
  });

  it('沒有商品：不顯示', () => {
    expect(orderCardState(order([]))).toBeNull();
  });
});

describe('formGate（S-2 各狀態）', () => {
  it('可以填', () => {
    expect(formGate(order([item('a', false)])).kind).toBe('form');
    expect(formGate(order([item('a', false), item('b', true)])).kind).toBe('form');
  });

  it('全部評過：唯讀', () => {
    expect(formGate(order([item('a', true)])).kind).toBe('readonly');
  });

  it('已過期、有評過的：唯讀；一件都沒評過：說明頁', () => {
    expect(formGate(order([item('a', true), item('b', false)], true)).kind).toBe('readonly');
    expect(formGate(order([item('a', false)], true)).kind).toBe('expiredEmpty');
  });

  it('可填的在前、已評的在後', () => {
    const { open, done } = partitionItems([item('a', true), item('b', false), item('c', false)]);
    expect(open.map(i => i.product_id)).toEqual(['b', 'c']);
    expect(done.map(i => i.product_id)).toEqual(['a']);
  });
});
