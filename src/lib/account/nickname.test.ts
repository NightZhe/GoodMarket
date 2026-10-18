import { describe, expect, it } from 'vitest';
import type { NicknamePrefill } from '../auth/identity';
import { nicknameDirty, resolveNicknamePrefill } from './nickname';

const google: NicknamePrefill = { value: '小明', original: '小 明', adjusted: true };

// 評價暱稱的預填順序（spec 5.8 第 5 點、AC-A8）：個人檔案的暱稱 → Google 名稱 → 空白
describe('resolveNicknamePrefill', () => {
  it('設了個人檔案暱稱：用它，不用 Google 名稱', () => {
    expect(resolveNicknamePrefill('小花貓', google)).toEqual({ value: '小花貓', original: '小花貓', adjusted: false, source: 'profile' });
  });
  it('沒設（null 或空白）而且是 Google 帳號：照現況預填 Google 名稱', () => {
    expect(resolveNicknamePrefill(null, google)).toEqual({ ...google, source: 'google' });
    expect(resolveNicknamePrefill('   ', google)).toEqual({ ...google, source: 'google' });
  });
  it('沒設的 Apple 帳號（沒有 Google 預填）：沒有預填，欄位空白', () => {
    expect(resolveNicknamePrefill(null, null)).toBeNull();
  });
  it('資料庫裡的暱稱若不合規則（不該發生）就不預填它，退回下一順位', () => {
    expect(resolveNicknamePrefill('a', google)).toEqual({ ...google, source: 'google' });
    expect(resolveNicknamePrefill('含 空白', null)).toBeNull();
  });
  it('讀取失敗（undefined）退回現況：Google 名稱或空白，不擋評價', () => {
    expect(resolveNicknamePrefill(undefined, google)).toEqual({ ...google, source: 'google' });
    expect(resolveNicknamePrefill(undefined, null)).toBeNull();
  });
});

// 儲存鈕「有沒有改動」：輸入值（去頭尾空白）與已存值比，兩者皆空＝沒改動
describe('nicknameDirty', () => {
  it('相同或只差頭尾空白＝沒改動；兩者皆空＝沒改動', () => {
    expect(nicknameDirty('小明', '小明')).toBe(false);
    expect(nicknameDirty(' 小明 ', '小明')).toBe(false);
    expect(nicknameDirty('', null)).toBe(false);
    expect(nicknameDirty('   ', null)).toBe(false);
  });
  it('改字、新設、清空＝有改動', () => {
    expect(nicknameDirty('小花', '小明')).toBe(true);
    expect(nicknameDirty('小明', null)).toBe(true);
    expect(nicknameDirty('', '小明')).toBe(true);
  });
});
