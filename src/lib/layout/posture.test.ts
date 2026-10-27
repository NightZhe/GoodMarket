import { describe, expect, it, vi } from 'vitest';
import { classifyBars, createPostureStore, type Insets } from './posture';

describe('classifyBars：只看左右安全區的差值，不看機型、寬度、orientation', () => {
  it('右側有系統欄（Duo 內橫實測 right 84、left 0）→ side-right', () => {
    expect(classifyBars({ left: 0, right: 84 })).toBe('side-right');
  });

  it('左側有系統欄（往另一邊轉、Split View 的左側 App）→ side-left', () => {
    expect(classifyBars({ left: 84, right: 0 })).toBe('side-left');
  });

  it('一般 iPhone 橫向：瀏海兩側對稱（47／47）→ bottom，不誤判成側邊姿態', () => {
    expect(classifyBars({ left: 47, right: 47 })).toBe('bottom');
  });

  it('Duo 內直（實測 left 0、right 0）與沒有 inset 的環境 → bottom', () => {
    expect(classifyBars({ left: 0, right: 0 })).toBe('bottom');
  });

  it('差值剛好 24 算側邊，23 還不算（門檻 24，推估值）', () => {
    expect(classifyBars({ left: 0, right: 24 })).toBe('side-right');
    expect(classifyBars({ left: 24, right: 0 })).toBe('side-left');
    expect(classifyBars({ left: 0, right: 23 })).toBe('bottom');
    expect(classifyBars({ left: 23, right: 0 })).toBe('bottom');
  });

  it('兩側都有 inset 但不對稱時看差值：右 84、左 47 → 差 37 → side-right', () => {
    expect(classifyBars({ left: 47, right: 84 })).toBe('side-right');
  });
});

describe('createPostureStore：姿態改變才通知，沒變就不重畫', () => {
  const make = (initial: Insets) => {
    let insets = initial;
    const apply = vi.fn();
    const store = createPostureStore(() => insets, apply);
    return { store, apply, set: (next: Insets) => { insets = next; } };
  };

  it('一開始是 bottom；refresh 讀到新的 inset 後 snapshot 換成對應姿態並寫出去', () => {
    const { store, apply, set } = make({ left: 0, right: 0 });
    expect(store.getSnapshot()).toBe('bottom');
    set({ left: 0, right: 84 });
    store.refresh();
    expect(store.getSnapshot()).toBe('side-right');
    expect(apply).toHaveBeenLastCalledWith('side-right');
  });

  it('旋轉後 inset 沒讓姿態改變（例如內直→佇立都是 bottom）時不通知訂閱者', () => {
    const { store, set } = make({ left: 0, right: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    set({ left: 0, right: 10 });
    store.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it('姿態改變時通知訂閱者；取消訂閱後不再通知', () => {
    const { store, set } = make({ left: 0, right: 0 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    set({ left: 0, right: 84 });
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    set({ left: 84, right: 0 });
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
