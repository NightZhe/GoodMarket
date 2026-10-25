import { describe, expect, it } from 'vitest';
import { REPORT_DETAILS_MAX, REPORT_REASONS } from './reasons';
import { checkDetails, codePointLength, remainingChars } from './validate';

// R-K5、AC-K4：說明 ≤200 字（code point）、去前後空白、空字串視為沒填、控制字元擋但換行允許
describe('檢舉說明的驗證', () => {
  it('沒填、只有空白（半形、全形、不換行空白、換行、Tab）→ 視為沒填，送 null', () => {
    for (const s of ['', '   ', '　　', ' ', '\n\n', '\t', ' 　 \n\t ']) {
      expect(checkDetails(s)).toEqual({ ok: true, value: null });
    }
  });
  it('去前後空白後送出；中間的內容與換行保留；\\r\\n 與 \\r 轉成 \\n', () => {
    expect(checkDetails('  價格不符  ')).toEqual({ ok: true, value: '價格不符' });
    expect(checkDetails('第一行\r\n第二行\r第三行')).toEqual({ ok: true, value: '第一行\n第二行\n第三行' });
  });
  it('剛好 200 字可送；201 字擋下並說超過幾字', () => {
    expect(checkDetails('字'.repeat(200))).toEqual({ ok: true, value: '字'.repeat(200) });
    expect(checkDetails('字'.repeat(201))).toEqual({ ok: false, reason: 'too_long', over: 1 });
    expect(checkDetails('字'.repeat(203))).toEqual({ ok: false, reason: 'too_long', over: 3 });
  });
  it('以 code point 計：200 個 emoji（每個 2 個 UTF-16 單位）可送，201 個擋', () => {
    expect(checkDetails('😀'.repeat(200)).ok).toBe(true);
    expect(checkDetails('😀'.repeat(201))).toEqual({ ok: false, reason: 'too_long', over: 1 });
    expect(codePointLength('😀a')).toBe(2);
  });
  it('前後的空白不算在 200 字裡', () => {
    expect(checkDetails(` ${'字'.repeat(200)} \n`).ok).toBe(true);
  });
  it('控制字元擋下（NUL、U+0001、中間的 Tab、DEL、C1）；換行允許', () => {
    for (const bad of ['a\u0000b', 'a\u0001b', 'a\tb', 'a\u007fb', 'a\u0085b', 'a\u009fb', 'a\u001fb']) {
      expect(checkDetails(bad)).toEqual({ ok: false, reason: 'invalid_chars' });
    }
    expect(checkDetails('a\nb').ok).toBe(true);
  });
  it('行首尾的 Tab 在去空白時就被去掉，不算控制字元', () => {
    expect(checkDetails('\t內容\t')).toEqual({ ok: true, value: '內容' });
  });
  it('HTML 與引號原樣保留（顯示時由 React 跳脫）', () => {
    expect(checkDetails('<b>"x"</b> & \'y\'')).toEqual({ ok: true, value: '<b>"x"</b> & \'y\'' });
  });
  it('剩餘字數：以去前後空白後的 code point 計，超過時為負數', () => {
    expect(remainingChars('')).toBe(REPORT_DETAILS_MAX);
    expect(remainingChars('  abc  ')).toBe(197);
    expect(remainingChars('😀'.repeat(30))).toBe(170);
    expect(remainingChars('字'.repeat(203))).toBe(-3);
  });
});

describe('檢舉原因清單（單一來源）', () => {
  it('六個代碼與資料庫一致、順序固定、每個都有選單文字與小字', () => {
    expect(REPORT_REASONS.map(r => r.code)).toEqual(['prohibited', 'counterfeit', 'scam', 'offensive', 'harassment', 'other']);
    for (const r of REPORT_REASONS) {
      expect(r.label).not.toBe('');
      expect(r.hint).not.toBe('');
    }
  });
});
