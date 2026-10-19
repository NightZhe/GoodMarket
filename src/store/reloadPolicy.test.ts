import { describe, expect, it } from 'vitest';
import { settleReload } from './reloadPolicy';

describe('商品重讀的結果怎麼處理', () => {
  it('成功：一律套用', () => {
    expect(settleReload({ ok: true, silent: false, loudPending: true })).toBe('apply');
    expect(settleReload({ ok: true, silent: true, loudPending: false })).toBe('apply');
  });
  it('一般重讀失敗：顯示載入失敗頁（既有行為）', () => {
    expect(settleReload({ ok: false, silent: false, loudPending: true })).toBe('report');
  });
  it('靜默重讀失敗：不換成載入失敗頁，畫面保留現有資料', () => {
    expect(settleReload({ ok: false, silent: true, loudPending: false })).toBe('ignore');
  });
  it('靜默重讀蓋掉了還在等的一般重讀、然後失敗：仍要報錯，不能讓一般重讀的轉圈卡住', () => {
    expect(settleReload({ ok: false, silent: true, loudPending: true })).toBe('report');
  });
});
