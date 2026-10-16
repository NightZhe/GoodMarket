import { describe, expect, it } from 'vitest';
import { needsStatusRefresh, replyErrorMessage, submitErrorMessage, toErrorCode } from './errors';

describe('toErrorCode', () => {
  it('認得的錯誤碼原樣回傳', () => {
    expect(toErrorCode('REVIEW_EXPIRED')).toBe('REVIEW_EXPIRED');
  });

  it('PostgREST 自己的 hint、空字串、undefined 都不算錯誤碼', () => {
    expect(toErrorCode('Perhaps you meant to reference the column')).toBeNull();
    expect(toErrorCode('')).toBeNull();
    expect(toErrorCode(undefined)).toBeNull();
  });
});

describe('錯誤訊息', () => {
  it('每個送出錯誤碼都有對應文字，沒有錯誤碼（網路）退回「內容都還在」', () => {
    expect(submitErrorMessage('CONTENT_TOO_LONG')).toBe('評價內容最多 500 字');
    expect(submitErrorMessage(null)).toContain('你填的內容和照片都還在');
    expect(submitErrorMessage('NOT_AUTHENTICATED')).toContain('你填的內容和照片都還在');
  });

  it('回覆錯誤', () => {
    expect(replyErrorMessage('REPLY_INVALID')).toBe('回覆需為 1 到 500 字');
    expect(replyErrorMessage('REVIEW_HIDDEN')).toBe('這則評價已被平台隱藏，無法回覆');
    expect(replyErrorMessage(null)).toContain('你輸入的內容還在');
  });

  it('哪些錯誤要重新取得訂單狀態', () => {
    expect(needsStatusRefresh('REVIEW_EXPIRED')).toBe(true);
    expect(needsStatusRefresh('ALREADY_REVIEWED')).toBe(true);
    expect(needsStatusRefresh('RATING_INVALID')).toBe(false);
    expect(needsStatusRefresh(null)).toBe(false);
  });
});
