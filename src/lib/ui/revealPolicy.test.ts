import { describe, expect, it } from 'vitest';
import { HOME_REVEAL_KEY, REVEAL_BATCH, browseRevealKey, hasMore, initialShown, nextShown, showBackToTop, syncReveal } from './revealPolicy';

describe('每批大小', () => {
  it('24 件：手機 2 欄、桌機 4／6 欄都整除', () => {
    expect(REVEAL_BATCH).toBe(24);
  });
});

describe('nextShown：下一批件數', () => {
  it('0 → 24、24 → 48', () => {
    expect(nextShown(71, 0)).toBe(24);
    expect(nextShown(71, 24)).toBe(48);
  });
  it('不超過總件數：總數 71 時 48 → 71', () => {
    expect(nextShown(71, 48)).toBe(71);
  });
  it('已經全畫：71 → 71 不再增加', () => {
    expect(nextShown(71, 71)).toBe(71);
  });
  it('總數 0：維持 0', () => {
    expect(nextShown(0, 0)).toBe(0);
  });
});

describe('initialShown：首次畫幾件', () => {
  it('返回＋記憶 60、總數 71 → 60', () => {
    expect(initialShown(71, 'back', 60)).toBe(60);
  });
  it('返回＋記憶 60、總數 30 → 30（截到總件數）', () => {
    expect(initialShown(30, 'back', 60)).toBe(30);
  });
  it('返回＋記憶 5 → 24（至少一批）', () => {
    expect(initialShown(71, 'back', 5)).toBe(24);
  });
  it('前往 → 24，不論記憶', () => {
    expect(initialShown(71, 'go', 60)).toBe(24);
    expect(initialShown(71, 'go', undefined)).toBe(24);
  });
  it('返回但無記憶 → 24', () => {
    expect(initialShown(71, 'back', undefined)).toBe(24);
  });
  it('總件數不到一批：畫總件數，不多畫', () => {
    expect(initialShown(10, 'go', undefined)).toBe(10);
    expect(initialShown(10, 'back', 60)).toBe(10);
    expect(initialShown(0, 'go', undefined)).toBe(0);
  });
});

describe('showBackToTop：要不要顯示「回到頂端」（D-1）', () => {
  it('總數 71 已畫 71 → 真', () => {
    expect(showBackToTop(71, 71)).toBe(true);
  });
  it('總數 71 已畫 48 → 假', () => {
    expect(showBackToTop(71, 48)).toBe(false);
  });
  it('總數 20 已畫 20 → 假（沒超過一批）', () => {
    expect(showBackToTop(20, 20)).toBe(false);
  });
  it('總數 24 已畫 24 → 假', () => {
    expect(showBackToTop(24, 24)).toBe(false);
  });
  it('總數 25 已畫 25 → 真', () => {
    expect(showBackToTop(25, 25)).toBe(true);
  });
});

describe('hasMore：還有沒有下一批', () => {
  it('71／48 → 真；71／71 → 假；0／0 → 假', () => {
    expect(hasMore(71, 48)).toBe(true);
    expect(hasMore(71, 71)).toBe(false);
    expect(hasMore(0, 0)).toBe(false);
  });
});

describe('記憶 key', () => {
  const base = { q: '耳機', cat: 'toys', sort: 'newest', free: true };
  it('逛逛四條件任一不同 → 不同 key', () => {
    const k = browseRevealKey(base);
    expect(browseRevealKey({ ...base, q: '手機' })).not.toBe(k);
    expect(browseRevealKey({ ...base, cat: 'food' })).not.toBe(k);
    expect(browseRevealKey({ ...base, sort: 'sales' })).not.toBe(k);
    expect(browseRevealKey({ ...base, free: false })).not.toBe(k);
  });
  it('條件相同但屬性順序不同 → 同 key', () => {
    expect(browseRevealKey({ free: true, sort: 'newest', cat: 'toys', q: '耳機' })).toBe(browseRevealKey(base));
  });
  it('空字串與缺省視為相同；預設排序（綜合）也視為沒指定', () => {
    expect(browseRevealKey({ q: '', cat: '', sort: '', free: false })).toBe(browseRevealKey({}));
    expect(browseRevealKey({ sort: 'relevance' })).toBe(browseRevealKey({}));
  });
  it('關鍵字前後空白不影響', () => {
    expect(browseRevealKey({ q: ' 耳機 ' })).toBe(browseRevealKey({ q: '耳機' }));
  });
  it('條件值含分隔符號也不會與別組撞 key', () => {
    expect(browseRevealKey({ q: 'a&cat=b' })).not.toBe(browseRevealKey({ q: 'a', cat: 'b' }));
  });
  it('首頁 key 與逛逛任何 key 都不同', () => {
    expect(HOME_REVEAL_KEY).not.toBe(browseRevealKey({}));
    expect(HOME_REVEAL_KEY).not.toBe(browseRevealKey(base));
  });
});

describe('syncReveal：導覽（location.key）變了要不要重置件數', () => {
  const prev = { loc: 'a', want: 96 };
  it('導覽沒變：保留目前想畫的件數（使用者滑出來的進度）', () => {
    expect(syncReveal(prev, 'a', 'go', 60)).toBe(prev);
  });
  it('前往（PUSH／REPLACE）換了導覽：回第一批，不讀記憶——就算記憶 key 沒變（逛逛再送出同樣的關鍵字）', () => {
    expect(syncReveal(prev, 'b', 'go', 96)).toEqual({ loc: 'b', want: REVEAL_BATCH });
  });
  it('返回換了導覽：以記憶還原件數', () => {
    expect(syncReveal(prev, 'b', 'back', 60)).toEqual({ loc: 'b', want: 60 });
  });
  it('返回但沒有記憶：第一批', () => {
    expect(syncReveal(prev, 'b', 'back', undefined)).toEqual({ loc: 'b', want: REVEAL_BATCH });
  });
});
