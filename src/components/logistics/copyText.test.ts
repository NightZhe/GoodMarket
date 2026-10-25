import { describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';

describe('複製到剪貼簿', () => {
  it('clipboard 成功：回傳 true，不呼叫舊做法', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = vi.fn().mockReturnValue(true);
    expect(await copyText('門市：全家', { writeText, legacyCopy })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('門市：全家');
    expect(legacyCopy).not.toHaveBeenCalled();
  });
  it('clipboard 被拒：退到舊做法，成功回傳 true', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const legacyCopy = vi.fn().mockReturnValue(true);
    expect(await copyText('x', { writeText, legacyCopy })).toBe(true);
    expect(legacyCopy).toHaveBeenCalledWith('x');
  });
  it('環境沒有 clipboard：直接用舊做法', async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);
    expect(await copyText('x', { writeText: undefined, legacyCopy })).toBe(true);
  });
  it('兩者都不行：回傳 false（呼叫端顯示失敗提示）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('no'));
    expect(await copyText('x', { writeText, legacyCopy: () => false })).toBe(false);
    expect(await copyText('x', { writeText: undefined, legacyCopy: () => false })).toBe(false);
  });
});
