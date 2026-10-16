import { describe, expect, it } from 'vitest';
import { draftKey, hasInput, parseDraft, splitUsablePhotos } from './draft';

describe('parseDraft', () => {
  it('讀得回寫進去的資料', () => {
    const raw = JSON.stringify({ nickname: '小貓', items: { a: { rating: 4, content: '好', photos: [{ path: 'x.jpg', expiresAt: '2026-10-16T10:00:00Z' }] } } });
    expect(parseDraft(raw)).toEqual({ nickname: '小貓', items: { a: { rating: 4, content: '好', photos: [{ path: 'x.jpg', expiresAt: '2026-10-16T10:00:00Z' }] } } });
  });

  it('壞資料一律回 null，不丟例外', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('')).toBeNull();
    expect(parseDraft('{not json')).toBeNull();
    expect(parseDraft('[]')).toBeNull();
    expect(parseDraft('{"items":[]}')).toBeNull();
  });

  it('欄位型別不對時退回預設值，不把壞值帶進表單', () => {
    const raw = JSON.stringify({ nickname: 5, items: { a: { rating: 9, content: 3, photos: [{ path: 1 }, { path: 'ok.jpg', expiresAt: 't' }] }, b: 'x' } });
    expect(parseDraft(raw)).toEqual({ nickname: '', items: { a: { rating: 0, content: '', photos: [{ path: 'ok.jpg', expiresAt: 't' }] } } });
  });

  it('小數星等不算數', () => {
    expect(parseDraft(JSON.stringify({ items: { a: { rating: 3.5 } } }))?.items.a.rating).toBe(0);
  });
});

describe('hasInput', () => {
  it('完全空白不算有輸入', () => {
    expect(hasInput({ nickname: ' ', items: { a: { rating: 0, content: '  ', photos: [] } } })).toBe(false);
  });

  it('只要有星等、文字、暱稱、照片任一個就算', () => {
    expect(hasInput({ nickname: 'x', items: {} })).toBe(true);
    expect(hasInput({ nickname: '', items: { a: { rating: 1, content: '', photos: [] } } })).toBe(true);
    expect(hasInput({ nickname: '', items: { a: { rating: 0, content: 'hi', photos: [] } } })).toBe(true);
    expect(hasInput({ nickname: '', items: { a: { rating: 0, content: '', photos: [{ path: 'p', expiresAt: 't' }] } } })).toBe(true);
  });
});

describe('splitUsablePhotos', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  it('位置還有一分鐘以上才保留', () => {
    const { kept, dropped } = splitUsablePhotos([
      { path: 'ok', expiresAt: '2026-10-16T10:20:00Z' },
      { path: 'almost', expiresAt: '2026-10-16T10:00:30Z' },
      { path: 'gone', expiresAt: '2026-10-16T09:00:00Z' },
    ], now);
    expect(kept.map(p => p.path)).toEqual(['ok']);
    expect(dropped).toBe(2);
  });
});

describe('draftKey', () => {
  it('每張訂單各有一份', () => {
    expect(draftKey('o1')).not.toBe(draftKey('o2'));
  });
});
