import { describe, expect, it } from 'vitest';
import { RAIL_GAP, pickRailLevel, railGroupHeight } from './railLevel';

describe('railGroupHeight：分頁組各層級的高度（design-spec §3.2.3）', () => {
  it('五格：L0＝6＋5×50＋6＝262、L1＝6＋5×44＋6＝232、L2＝一顆 56', () => {
    expect(railGroupHeight('L0', 5)).toBe(262);
    expect(railGroupHeight('L1', 5)).toBe(232);
    expect(railGroupHeight('L2', 5)).toBe(56);
  });
});

describe('pickRailLevel：依分頁組可用高度取第一個放得下的層級', () => {
  const pick = (available: number, labelsFit = true) => pickRailLevel({ available, count: 5, labelsFit });

  it('剛好放得下 L0（262）就是 L0，少 1 就降 L1', () => {
    expect(pick(262)).toBe('L0');
    expect(pick(261)).toBe('L1');
  });

  it('剛好放得下 L1（232）就是 L1，少 1 就收成 L2', () => {
    expect(pick(232)).toBe('L1');
    expect(pick(231)).toBe('L2');
  });

  it('標籤放不下（文字放大）時不論高度多夠，最多 L1', () => {
    expect(pick(600, false)).toBe('L1');
    expect(pick(100, false)).toBe('L2');
  });

  it('連 56 都放不下也留在 L2，不消失、不出現「…」', () => {
    expect(pick(0)).toBe('L2');
  });

  it('賣家與買家同樣五格；格數不同時用實際格數算', () => {
    expect(pickRailLevel({ available: 6 + 4 * 50 + 6, count: 4, labelsFit: true })).toBe('L0');
  });
});

describe('各姿態實測高度落在的層級（工具組與分頁組之間留 RAIL_GAP）', () => {
  const tools = (n: number) => 6 + n * 44 + 6;
  const room = (regionHeight: number, toolCount: number) =>
    regionHeight - (toolCount > 0 ? tools(toolCount) + RAIL_GAP : 0);

  it('外直 678：起點 153、底 34 → 區間 491；店家頁（3 顆工具）扣 156 剩 335 → L0', () => {
    expect(pickRailLevel({ available: room(678 - 153 - 34, 3), count: 5, labelsFit: true })).toBe('L0');
  });

  it('外橫 primary 466：起點 78、底 34 → 區間 354；首頁（1 顆購物車）扣 68 剩 286 → L0', () => {
    expect(pickRailLevel({ available: room(466 - 78 - 34, 1), count: 5, labelsFit: true })).toBe('L0');
  });

  it('外橫 primary 店家頁（3 顆）：354−156＝198 → L2', () => {
    expect(pickRailLevel({ available: room(466 - 78 - 34, 3), count: 5, labelsFit: true })).toBe('L2');
  });

  it('外橫 secondary 466（X9）：起點 12、底 74 → 區間 380；首頁（1 顆）扣 68 剩 312 → L0；店家頁（3 顆）剩 224 → L2', () => {
    expect(pickRailLevel({ available: room(466 - 12 - 74, 1), count: 5, labelsFit: true })).toBe('L0');
    expect(pickRailLevel({ available: room(466 - 12 - 74, 3), count: 5, labelsFit: true })).toBe('L2');
  });

  it('內橫 669：起點 116、底 34 → 區間 519；店家頁（3 顆）剩 363 → L0（與 T3 一致）', () => {
    expect(pickRailLevel({ available: room(669 - 116 - 34, 3), count: 5, labelsFit: true })).toBe('L0');
  });
});
