import { describe, expect, it } from 'vitest';
import { clockTime, dateLabel, groupByDate, listTime, previewSpoken, previewText, rowSpoken } from './format';
import type { LastMessage } from './types';

// 2026-10-28 是星期三。時間都用本機時區組出來，測試在任何時區都成立
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 9, 28, 15, 0);

describe('日期分隔與時間（§8.2、設計 4.3）', () => {
  it('今天、昨天、本年、跨年', () => {
    expect(dateLabel(at(2026, 10, 28, 0, 5), NOW)).toBe('今天');
    expect(dateLabel(at(2026, 10, 27, 23, 59), NOW)).toBe('昨天');
    expect(dateLabel(at(2026, 10, 26), NOW)).toBe('10月26日 星期一');
    expect(dateLabel(at(2025, 12, 7), NOW)).toBe('2025年12月7日');
  });

  it('每則訊息時間是 24 小時制 HH:mm', () => {
    expect(clockTime(at(2026, 10, 28, 9, 5))).toBe('09:05');
    expect(clockTime(at(2026, 10, 28, 19, 54))).toBe('19:54');
  });

  it('列表時間：今天看時間、昨天、7 天內看星期、今年看月/日、跨年看年/月/日', () => {
    expect(listTime(at(2026, 10, 28, 9, 0), NOW)).toBe('09:00');
    expect(listTime(at(2026, 10, 27, 20, 0), NOW)).toBe('昨天');
    expect(listTime(at(2026, 10, 22), NOW)).toBe('星期四');
    expect(listTime(at(2026, 10, 21), NOW)).toBe('10/21');
    expect(listTime(at(2025, 12, 7), NOW)).toBe('2025/12/7');
  });

  it('同一天的訊息分在同一組，換天才換組，順序不變', () => {
    const msgs = [
      { at: at(2026, 10, 26, 9), n: 1 }, { at: at(2026, 10, 26, 23), n: 2 },
      { at: at(2026, 10, 28, 1), n: 3 },
    ];
    const g = groupByDate(msgs, m => m.at, NOW);
    expect(g.map(x => x.label)).toEqual(['10月26日 星期一', '今天']);
    expect(g.map(x => x.items.map(m => m.n))).toEqual([[1, 2], [3]]);
    expect(groupByDate([], (m: { at: string }) => m.at, NOW)).toEqual([]);
  });
});

const last = (p: Partial<LastMessage>): LastMessage => ({ side: 'shop', mine: false, text: null, photo_count: 0, card_type: null, at: '', ...p });

describe('列表摘要（§8.1）', () => {
  it('文字優先；自己送的加「你：」', () => {
    expect(previewText(last({ text: '有現貨嗎？' }))).toBe('有現貨嗎？');
    expect(previewText(last({ text: '有的', mine: true }))).toBe('你：有的');
  });
  it('沒有文字：圖片 ＞ 商品 ＞ 訂單；有文字又有圖片顯示文字', () => {
    expect(previewText(last({ photo_count: 2 }))).toBe('[圖片]');
    expect(previewText(last({ card_type: 'product' }))).toBe('[商品]');
    expect(previewText(last({ card_type: 'order' }))).toBe('[訂單]');
    expect(previewText(last({ photo_count: 1, card_type: 'order' }))).toBe('[圖片]');
    expect(previewText(last({ text: '照片', photo_count: 1 }))).toBe('照片');
  });
  it('朗讀不念括號與「你：」', () => {
    expect(previewSpoken(last({ photo_count: 1 }))).toBe('圖片');
    expect(previewSpoken(last({ card_type: 'product' }))).toBe('商品卡');
    expect(previewSpoken(last({ card_type: 'order' }))).toBe('訂單卡');
    expect(previewSpoken(last({ text: '有的', mine: true }))).toBe('有的');
  });
  it('列表一列的朗讀句型（設計 9.2）', () => {
    expect(rowSpoken({ name: '好物小舖', unread: 2, last: last({ text: '有的' }), time: '19:02', blocked: false }))
      .toBe('好物小舖，2 則未讀，最後訊息：有的，19:02');
    expect(rowSpoken({ name: '好物小舖', unread: 0, last: last({ card_type: 'order' }), time: '昨天', blocked: true }))
      .toBe('好物小舖，已封鎖，最後訊息：訂單卡，昨天');
  });
});
