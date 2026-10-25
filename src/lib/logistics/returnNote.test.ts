import { describe, expect, it } from 'vitest';
import { NOTE_MAX, noteLength, noteStatus, normalizeNote, remainText } from './returnNote';

describe('退貨說明字數（code point，AC-L20）', () => {
  it('上限 200', () => expect(NOTE_MAX).toBe(200));
  it('emoji 與擴充區漢字算 1 個字', () => {
    expect(noteLength('😀'.repeat(200))).toBe(200);
    expect(noteLength('𠮷')).toBe(1);
  });
  it('換行算 1 個字；CRLF 先轉成 LF（與資料庫一致）', () => {
    expect(noteLength('a\r\nb')).toBe(3);
    expect(normalizeNote('a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('頭尾的空白與換行不算', () => {
    expect(noteLength('  \n 聯絡我 \n ')).toBe(3);
    expect(normalizeNote('　請先聯絡　')).toBe('請先聯絡');
  });
});

describe('noteStatus：剩餘字數、有沒有改、能不能存', () => {
  it('沒打任何字、也沒存過：沒改、不能存、剩 200', () => {
    const s = noteStatus('', null);
    expect(s).toMatchObject({ length: 0, remaining: 200, over: 0, dirty: false, canSave: false, error: null });
  });
  it('正好 200 字可以存；201 字超過 1、不能存、有錯誤句', () => {
    const at = noteStatus('字'.repeat(200), null);
    expect(at).toMatchObject({ remaining: 0, over: 0, dirty: true, canSave: true, error: null });
    const over = noteStatus('字'.repeat(201), null);
    expect(over).toMatchObject({ remaining: -1, over: 1, dirty: true, canSave: false });
    expect(over.error).toBe('退貨說明最多 200 字，目前多了 1 字');
  });
  it('和已存的內容相同（含只差頭尾空白）：沒改、不能存', () => {
    expect(noteStatus('請先聯絡', '請先聯絡')).toMatchObject({ dirty: false, canSave: false });
    expect(noteStatus('請先聯絡 \n', '請先聯絡')).toMatchObject({ dirty: false, canSave: false });
  });
  it('清空一個已存的說明：算有改、可以存（存下去＝清除）', () => {
    expect(noteStatus('', '請先聯絡')).toMatchObject({ length: 0, dirty: true, canSave: true });
    expect(noteStatus('  \n ', '請先聯絡')).toMatchObject({ dirty: true, canSave: true });
  });
  it('換行可以；Tab 等其他控制字元不行（資料庫回 RETURN_NOTE_INVALID）', () => {
    expect(noteStatus('第一行\n第二行', null)).toMatchObject({ canSave: true, error: null });
    const tab = noteStatus('a\tb', null);
    expect(tab.canSave).toBe(false);
    expect(tab.error).toBe('退貨說明含有不能使用的字元');
  });
  it('網址、角括號原樣當純文字，不擋', () => {
    expect(noteStatus('https://example.com <b>', null).canSave).toBe(true);
  });
});

describe('剩餘字數文字', () => {
  it('剩 N 字／超過 N 字', () => {
    expect(remainText(15)).toBe('剩 15 字');
    expect(remainText(0)).toBe('剩 0 字');
    expect(remainText(-3)).toBe('超過 3 字');
  });
});
