import { describe, expect, it } from 'vitest';
import {
  NICKNAME_PROMPT_KEY, NICKNAME_PROMPT_PENDING_KEY, PENDING_TTL_MS, clearNicknamePromptPending, dismissNicknamePrompt, markNicknamePromptPending,
  nicknamePromptDismissed, shouldPromptNickname, takeNicknamePromptPending,
} from './nicknamePrompt';
import type { StorageLike } from '../auth/pending';

const mem = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
};
const broken: StorageLike = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => undefined };

describe('顯示名稱邀請：本機略過紀錄（D11）', () => {
  it('沒略過過＝false；略過後寫 "1" 並回 true；之後讀到 true', () => {
    const s = mem();
    expect(nicknamePromptDismissed(s)).toBe(false);
    expect(dismissNicknamePrompt(s)).toBe(true);
    expect(s.data[NICKNAME_PROMPT_KEY]).toBe('1');
    expect(nicknamePromptDismissed(s)).toBe(true);
  });
  it('鍵名固定為 goodmarket.nicknamePromptDismissed（spec B5）', () => {
    expect(NICKNAME_PROMPT_KEY).toBe('goodmarket.nicknamePromptDismissed');
  });
  it('沒有 storage 或 storage 會丟例外：讀當沒略過、寫回 false，不丟出去', () => {
    expect(nicknamePromptDismissed(null)).toBe(false);
    expect(dismissNicknamePrompt(null)).toBe(false);
    expect(nicknamePromptDismissed(broken)).toBe(false);
    expect(dismissNicknamePrompt(broken)).toBe(false);
  });
});

describe('要不要彈', () => {
  it('賣家端永遠不彈；買家已略過不彈', () => {
    expect(shouldPromptNickname({ side: 'shop', dismissed: false, nickname: null })).toBe(false);
    expect(shouldPromptNickname({ side: 'buyer', dismissed: true, nickname: null })).toBe(false);
  });
  it('買家、沒略過、沒暱稱（null 或空白）→ 彈；已有暱稱 → 不彈', () => {
    expect(shouldPromptNickname({ side: 'buyer', dismissed: false, nickname: null })).toBe(true);
    expect(shouldPromptNickname({ side: 'buyer', dismissed: false, nickname: '  ' })).toBe(true);
    expect(shouldPromptNickname({ side: 'buyer', dismissed: false, nickname: '小明' })).toBe(false);
  });
  it('還沒查暱稱（undefined）時只看 side 與略過紀錄，決定要不要去查', () => {
    expect(shouldPromptNickname({ side: 'buyer', dismissed: false, nickname: undefined })).toBe(true);
    expect(shouldPromptNickname({ side: 'buyer', dismissed: true, nickname: undefined })).toBe(false);
    expect(shouldPromptNickname({ side: 'shop', dismissed: false, nickname: undefined })).toBe(false);
  });
});

describe('待邀請旗標：第一則建立對話後網址會換、元件重掛，旗標要撐過重掛', () => {
  it('mark 後 take 一次拿到 true 並移除；再 take 是 false', () => {
    const s = mem();
    expect(markNicknamePromptPending(s, 1000)).toBe(true);
    expect(s.data[NICKNAME_PROMPT_PENDING_KEY]).toBe('1000');
    expect(takeNicknamePromptPending(s, 1500)).toBe(true);
    expect(s.data[NICKNAME_PROMPT_PENDING_KEY]).toBeUndefined();
    expect(takeNicknamePromptPending(s, 1600)).toBe(false);
  });
  it('超過有效期（60 秒）或時間倒退的旗標：take 回 false 但一樣移除；壞值也是 false', () => {
    const s = mem();
    markNicknamePromptPending(s, 1000);
    expect(takeNicknamePromptPending(s, 1000 + PENDING_TTL_MS + 1)).toBe(false);
    expect(s.data[NICKNAME_PROMPT_PENDING_KEY]).toBeUndefined();
    markNicknamePromptPending(s, 5000);
    expect(takeNicknamePromptPending(s, 4000)).toBe(false);
    expect(takeNicknamePromptPending(mem({ [NICKNAME_PROMPT_PENDING_KEY]: 'abc' }), 1)).toBe(false);
  });
  it('clear 會移除；沒有 storage 或 storage 壞掉時全部安靜地回 false', () => {
    const s = mem({ [NICKNAME_PROMPT_PENDING_KEY]: '1' });
    clearNicknamePromptPending(s);
    expect(s.data[NICKNAME_PROMPT_PENDING_KEY]).toBeUndefined();
    expect(markNicknamePromptPending(null, 1)).toBe(false);
    expect(takeNicknamePromptPending(null, 1)).toBe(false);
    expect(markNicknamePromptPending(broken, 1)).toBe(false);
    expect(takeNicknamePromptPending(broken, 1)).toBe(false);
    expect(() => clearNicknamePromptPending(broken)).not.toThrow();
  });
});
