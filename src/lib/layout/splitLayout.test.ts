import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSplitLayout, SPLIT_QUERY } from './splitLayout';

afterEach(() => vi.unstubAllGlobals());
const withMedia = (matches: boolean) => vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q === SPLIT_QUERY && matches }) });

describe('isSplitLayout：賣家聊聊的左列表右對話（只在網頁版 ≥ 768）', () => {
  it('網頁版視窗夠寬：是', () => {
    withMedia(true);
    expect(isSplitLayout(false)).toBe(true);
  });
  it('視窗不夠寬：否', () => {
    withMedia(false);
    expect(isSplitLayout(false)).toBe(false);
  });
  it('App 內永遠否，不管多寬（md: 在 App 內不生效，與 index.css 同一口徑）', () => {
    withMedia(true);
    expect(isSplitLayout(true)).toBe(false);
  });
  it('沒有 matchMedia（伺服器端渲染、測試環境）：否', () => {
    vi.stubGlobal('window', {});
    expect(isSplitLayout(false)).toBe(false);
  });
});
