import { describe, expect, it } from 'vitest';
import { RULES_KEY, RULES_TEXT, dismissRules, rulesDismissed, rulesVisible } from './rules';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe('規則提示（AC-M38）', () => {
  it('文字逐字照 §10.2', () => {
    expect(RULES_TEXT).toBe('為了交易安全，請勿在對話中提供電話、LINE 等聯絡方式；站外交易不受好物集保障。');
  });
  it('沒按關閉：每次進對話頁都顯示', () => {
    const s = memory();
    expect(rulesDismissed(s)).toBe(false);
    expect(rulesDismissed(s)).toBe(false);
  });
  it('按關閉後記住，之後任何對話都不再顯示；清掉本機資料後再出現', () => {
    const s = memory();
    expect(dismissRules(s)).toBe(true);
    expect(rulesDismissed(s)).toBe(true);
    s.removeItem(RULES_KEY);
    expect(rulesDismissed(s)).toBe(false);
  });
  it('讀寫都丟例外（封鎖網站資料）：當作還沒關閉，不讓頁面壞掉', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => undefined };
    expect(rulesDismissed(broken)).toBe(false);
    expect(dismissRules(broken)).toBe(false);
    expect(rulesDismissed(null)).toBe(false);
    expect(dismissRules(null)).toBe(false);
  });
});

describe('規則提示顯示條件（§8.2、AC-M23 B1）', () => {
  it('沒按關閉就顯示；顯示與否只取決於是否關閉過（不看輸入框焦點或螢幕高度）', () => {
    expect(rulesVisible(false)).toBe(true);
    expect(rulesVisible(true)).toBe(false);
  });
});
