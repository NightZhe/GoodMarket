import { describe, expect, it } from 'vitest';
import { classifyAuthCode, userMessageForDecline } from './ecpayCodes.ts';

describe('classifyAuthCode', () => {
  it('1 → authorized', () => expect(classifyAuthCode(1)).toBe('authorized'));
  it('10300066 → unknown（待確認，請勿當失敗）', () => expect(classifyAuthCode(10300066)).toBe('unknown'));
  it.each([10100251, 10100255, 10100256])('%i → card_invalid', (c) => expect(classifyAuthCode(c)).toBe('card_invalid'));
  it.each([10100248, 10100252, 10100254, 5000039, 99999999])('%i → declined', (c) => expect(classifyAuthCode(c)).toBe('declined'));
});

describe('userMessageForDecline（給買家看的中文）', () => {
  it('額度不足', () => expect(userMessageForDecline(10100252)).toContain('額度'));
  it('卡片失效要換卡', () => expect(userMessageForDecline(10100251)).toContain('換'));
  it('不認得的代碼用通用說法，不洩漏英文原文', () => expect(userMessageForDecline(424242)).toBe('這張卡這次授權沒有成功，請換一張卡或稍後再試。'));
});
