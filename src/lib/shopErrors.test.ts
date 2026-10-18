import { describe, expect, it } from 'vitest';
import { shopErrorText } from './shopErrors';

describe('開店失敗的文字', () => {
  it('一個帳號只能有一家店', () => {
    expect(shopErrorText('duplicate key value violates unique constraint "shops_owner_unique"')).toBe('這個帳號已經有一家店了');
  });
  it('連不上伺服器（各瀏覽器的說法）', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) expect(shopErrorText(m)).toBe('連不上伺服器，請檢查網路後再試。');
  });
  it('其他一律中文，不顯示英文原文', () => {
    expect(shopErrorText('Invalid login credentials')).toBe('沒有完成，請再試一次。');
    expect(shopErrorText('')).toBe('沒有完成，請再試一次。');
  });
});
