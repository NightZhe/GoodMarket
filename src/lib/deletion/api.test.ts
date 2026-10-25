import { describe, expect, it } from 'vitest';
import { AccountError } from '../account/errors';
import { parseRequest, parseStatus } from './api';

const REQ = { id: 'bb07ebb4', status: 'pending', requested_at: '2026-10-25T11:36:08.793527+00:00', due_date: '2026-11-03' };

describe('parseStatus：資料庫回傳的形狀', () => {
  it('沒有申請', () => {
    expect(parseStatus({ request: null, has_shop: false, unfinished_buyer_orders: 0, unfinished_shop_orders: 0 }))
      .toEqual({ request: null, has_shop: false, unfinished_buyer_orders: 0, unfinished_shop_orders: 0 });
  });
  it('有處理中的申請，多餘欄位忽略', () => {
    const s = parseStatus({ request: { ...REQ, extra: 1 }, has_shop: true, unfinished_buyer_orders: 1, unfinished_shop_orders: 2 });
    expect(s.request).toEqual(REQ);
    expect(s.has_shop).toBe(true);
  });
  it('形狀不對丟 server 錯誤（不把壞資料當成「可申請」）', () => {
    const bad: unknown[] = [
      null, 'x', [], {},
      { request: null, has_shop: 'no', unfinished_buyer_orders: 0, unfinished_shop_orders: 0 },
      { request: null, has_shop: false, unfinished_buyer_orders: -1, unfinished_shop_orders: 0 },
      { request: null, has_shop: false, unfinished_buyer_orders: 1.5, unfinished_shop_orders: 0 },
      { request: null, has_shop: false, unfinished_buyer_orders: 0 },
      { request: { id: 'x' }, has_shop: false, unfinished_buyer_orders: 0, unfinished_shop_orders: 0 },
      { request: { ...REQ, status: 'cancelled' }, has_shop: false, unfinished_buyer_orders: 0, unfinished_shop_orders: 0 },
    ];
    for (const b of bad) {
      let caught: unknown;
      try { parseStatus(b); } catch (e) { caught = e; }
      expect(caught, JSON.stringify(b)).toBeInstanceOf(AccountError);
      expect((caught as AccountError).kind).toBe('server');
    }
  });
});

describe('parseRequest', () => {
  it('request_account_deletion 回的是申請本身', () => {
    expect(parseRequest(REQ)).toEqual(REQ);
  });
  it('缺欄位、型別不對、不是 pending → null', () => {
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest({ ...REQ, due_date: 20261103 })).toBeNull();
    expect(parseRequest({ ...REQ, status: 'done' })).toBeNull();
    expect(parseRequest({ request: REQ })).toBeNull();
  });
});
