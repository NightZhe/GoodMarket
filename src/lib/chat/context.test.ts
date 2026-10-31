import { describe, expect, it } from 'vitest';
import { contextLine, lastCardOf, orderNoTail } from './context';
import type { DisplayMessage } from './outbox';
import type { ChatCard } from './types';

const product: ChatCard = { type: 'product', id: 'p1', title: '【Jy】Switch 任天堂 NS 咚奇剛', image: '', price: 1000 };
const order: ChatCard = { type: 'order', id: 'o1', order_no: '261028SRPA9T6C', title: 'Switch 寶可夢', image: '', item_count: 2, total: 1537, status: 'to_ship' };
const msg = (p: Partial<DisplayMessage>): DisplayMessage => ({
  key: 'k', clientId: 'k', id: 'm', seq: 1, mine: false, side: 'shop', text: '嗨', card: null, photos: [], photosAreLocal: false,
  at: '2026-10-27T11:50:00.000Z', state: 'sent', failure: null, ...p,
});

describe('脈絡列文字（D10）', () => {
  it('訂單卡：「訂單 #末 6 碼 · 商品名」', () => {
    expect(contextLine(order)).toBe('訂單 #RPA9T6C'.replace('RPA9T6C', 'PA9T6C') + ' · Switch 寶可夢');
    expect(orderNoTail('261028SRPA9T6C')).toBe('PA9T6C');
  });
  it('訂單編號不足 6 碼就整個顯示；沒有商品名只顯示編號', () => {
    expect(contextLine({ type: 'order', id: 'o', title: '', order_no: 'T12' })).toBe('訂單 #T12');
  });
  it('商品卡：只有商品名', () => {
    expect(contextLine(product)).toBe('【Jy】Switch 任天堂 NS 咚奇剛');
  });
  it('列表 RPC 的 last_card 形狀（沒有 image／price）也能用；商品卡的 order_no 是 null', () => {
    expect(contextLine({ type: 'product', id: 'p', title: '耳機', order_no: null })).toBe('耳機');
    expect(contextLine({ type: 'order', id: 'o', title: '耳機', order_no: 'T000001' })).toBe('訂單 #000001 · 耳機');
  });
  it('沒有卡（null）、舊資料庫沒有這個鍵（undefined）、空商品名 → null，呼叫端不渲染', () => {
    expect(contextLine(null)).toBeNull();
    expect(contextLine(undefined)).toBeNull();
    expect(contextLine({ type: 'product', id: 'p', title: '  ', order_no: null })).toBeNull();
    expect(contextLine({ type: 'order', id: 'o', title: '', order_no: '' })).toBeNull();
  });
});

describe('對話頁：從已載入訊息找最近一張卡', () => {
  it('取最新（陣列尾端）那一則帶卡的訊息', () => {
    const list = [msg({ key: 'a', card: product }), msg({ key: 'b', text: '有的' }), msg({ key: 'c', card: order, mine: true, side: 'buyer' })];
    expect(lastCardOf(list)).toEqual(order);
  });
  it('送出失敗的卡不算；都沒有卡 → null', () => {
    expect(lastCardOf([msg({ key: 'a', card: product }), msg({ key: 'b', card: order, state: 'failed' })])).toEqual(product);
    expect(lastCardOf([msg({ key: 'a' })])).toBeNull();
    expect(lastCardOf([])).toBeNull();
  });
  it('傳送中的卡算（畫面上已經看得到那張卡）', () => {
    expect(lastCardOf([msg({ key: 'a', card: order, state: 'sending' })])).toEqual(order);
  });
});
