import { describe, expect, it, vi } from 'vitest';
import { classifyBars, classifyRail, createPostureStore, watchViewport, type Insets, type ViewportEnv } from './posture';

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
    expect(apply).toHaveBeenLastCalledWith('side-right', 'default');
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

describe('classifyRail：直立軌的起點與底緣依姿態實測（decisions 第七節、X9）', () => {
  it('外直（466×678、系統欄在右）→ outer-portrait：狀態區到 141，軌起點 ≥ 153', () => {
    expect(classifyRail({ bars: 'side-right', orientation: 'portrait-primary', width: 466, height: 678 })).toBe('outer-portrait');
  });

  it('外橫 landscape-primary（系統欄在左）→ outer-landscape-primary：只有相機，軌起點 ≥ 78', () => {
    expect(classifyRail({ bars: 'side-left', orientation: 'landscape-primary', width: 678, height: 466 })).toBe('outer-landscape-primary');
  });

  it('外橫 landscape-secondary 且系統欄在右 → outer-landscape-secondary（X9：相機在欄底，軌底緣留 74）', () => {
    expect(classifyRail({ bars: 'side-right', orientation: 'landscape-secondary', width: 678, height: 466 })).toBe('outer-landscape-secondary');
  });

  it('內橫（951×669，實測 landscape-secondary、右 84）→ default：不套外螢幕規則，仍是起點 116', () => {
    expect(classifyRail({ bars: 'side-right', orientation: 'landscape-secondary', width: 951, height: 669 })).toBe('default');
  });

  it('視窗寬 678 剛好算外螢幕，679 不算', () => {
    expect(classifyRail({ bars: 'side-right', orientation: 'landscape-secondary', width: 678, height: 466 })).toBe('outer-landscape-secondary');
    expect(classifyRail({ bars: 'side-right', orientation: 'landscape-secondary', width: 679, height: 466 })).toBe('default');
  });

  it('bottom 姿態沒有軌，一律 default（外直之外的窄視窗如一般 iPhone 也不誤判）', () => {
    expect(classifyRail({ bars: 'bottom', orientation: 'portrait-primary', width: 393, height: 852 })).toBe('default');
    expect(classifyRail({ bars: 'bottom', orientation: 'landscape-primary', width: 600, height: 400 })).toBe('default');
  });

  it('讀不到 screen.orientation 時由視窗長寬與系統欄側推：橫向右欄＝secondary、左欄＝primary、直向＝portrait', () => {
    expect(classifyRail({ bars: 'side-right', width: 678, height: 466 })).toBe('outer-landscape-secondary');
    expect(classifyRail({ bars: 'side-left', width: 678, height: 466 })).toBe('outer-landscape-primary');
    expect(classifyRail({ bars: 'side-right', width: 466, height: 678 })).toBe('outer-portrait');
  });

  it('orientation 與系統欄的側對不上（primary 卻在右）→ default，不猜', () => {
    expect(classifyRail({ bars: 'side-right', orientation: 'landscape-primary', width: 678, height: 466 })).toBe('default');
    expect(classifyRail({ bars: 'side-left', orientation: 'landscape-secondary', width: 678, height: 466 })).toBe('default');
  });

  it('沒有視窗尺寸（舊呼叫端只給 inset）→ default', () => {
    expect(classifyRail({ bars: 'side-right' })).toBe('default');
  });
});

describe('createPostureStore：軌的版型也是姿態的一部分', () => {
  it('旋轉讓版型改變（外橫 primary → secondary）時通知訂閱者並寫出去，即使 bars 的側也跟著變', () => {
    let reading = { left: 84, right: 0, width: 678, height: 466, orientation: 'landscape-primary' };
    const apply = vi.fn();
    const store = createPostureStore(() => reading, apply);
    expect(apply).toHaveBeenLastCalledWith('side-left', 'outer-landscape-primary');
    const listener = vi.fn();
    store.subscribe(listener);
    reading = { left: 0, right: 84, width: 678, height: 466, orientation: 'landscape-secondary' };
    store.refresh();
    expect(apply).toHaveBeenLastCalledWith('side-right', 'outer-landscape-secondary');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('bars 沒變、版型也沒變就不通知', () => {
    const reading = { left: 0, right: 84, width: 466, height: 678, orientation: 'portrait-primary' };
    const store = createPostureStore(() => reading, vi.fn());
    const listener = vi.fn();
    store.subscribe(listener);
    store.refresh();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('展開成內橫（QA2 B4）：安全區不變、只有視窗寬 678 → 951，要靠視窗大小的監看來源重判', () => {
  // 假環境：不發 resize／orientationchange／visibilitychange，只讓 ResizeObserver 或 matchMedia 的 change 觸發（模擬 WKWebView 展開時沒發 resize）
  const setup = () => {
    let reading = { left: 0, right: 84, width: 678, height: 466, orientation: 'landscape-secondary' };
    const apply = vi.fn();
    const store = createPostureStore(() => reading, apply);
    const roCallbacks: Array<() => void> = [];
    const mqlCallbacks: Array<() => void> = [];
    const observed: unknown[] = [];
    const queries: string[] = [];
    const root = {} as Element;
    const env: ViewportEnv = {
      root,
      matchMedia: query => {
        queries.push(query);
        return { addEventListener: (_type, listener) => { mqlCallbacks.push(listener); } };
      },
      ResizeObserver: class {
        constructor(callback: () => void) { roCallbacks.push(callback); }
        observe(target: Element) { observed.push(target); }
      },
    };
    watchViewport(env, () => store.refresh());
    const unfold = () => { reading = { left: 0, right: 84, width: 951, height: 669, orientation: 'landscape-secondary' }; };
    return { store, apply, roCallbacks, mqlCallbacks, observed, queries, root, unfold };
  };

  it('起點是外橫 secondary；展開後 ResizeObserver 觸發 → 重判成 default 並通知訂閱者', () => {
    const { store, apply, roCallbacks, unfold } = setup();
    expect(store.getSnapshot()).toBe('side-right');
    expect(apply).toHaveBeenLastCalledWith('side-right', 'outer-landscape-secondary');
    const listener = vi.fn();
    store.subscribe(listener);
    unfold();
    roCallbacks.forEach(cb => cb());
    expect(apply).toHaveBeenLastCalledWith('side-right', 'default');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('只有 matchMedia 的 change 觸發也能重判（兩個來源互相備援）', () => {
    const { apply, mqlCallbacks, unfold } = setup();
    unfold();
    mqlCallbacks.forEach(cb => cb());
    expect(apply).toHaveBeenLastCalledWith('side-right', 'default');
  });

  it('ResizeObserver 看的是 <html>，matchMedia 的門檻是外螢幕寬上限 + 1（679）', () => {
    const { observed, queries, root } = setup();
    expect(observed).toEqual([root]);
    expect(queries).toEqual(['(min-width: 679px)']);
  });

  it('視窗大小事件觸發但姿態沒變（外橫內縮放等）→ 不通知', () => {
    const { store, roCallbacks } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    roCallbacks.forEach(cb => cb());
    expect(listener).not.toHaveBeenCalled();
  });
});
