import { useSyncExternalStore } from 'react';
import { isNative } from '../native/platform';

// 姿態判定（iPhone Duo 適配，decisions 四-1、design-spec §2.1）。
// 系統欄在左右側直立時（外蓋、展開橫向、書本、Split View），左右安全區「不對稱」：
// 只看 right − left 的差值，不看機型、視窗寬度、orientation。結果寫到 <html data-bars>，CSS 與元件共用同一份。
//   side-right：右側有系統欄（Duo 常態）｜side-left：左側有｜bottom：其餘（一般 iPhone 直橫、Duo 內直、佇立）
// 只在 App 內判定：網頁版（Safari）自己有工具列，永遠是 bottom。

export type Bars = 'bottom' | 'side-left' | 'side-right';
export type Insets = { left: number; right: number };

/** 判定門檻（pt）。推估值：小於觸控目標 44 的一半，不會誤判對稱的瀏海機，也不會漏掉 Duo 的 73–84。T0 量到外蓋／半折實測值後以實測為準 */
export const SIDE_THRESHOLD = 24;

export function classifyBars({ left, right }: Insets): Bars {
  if (right - left >= SIDE_THRESHOLD) return 'side-right';
  if (left - right >= SIDE_THRESHOLD) return 'side-left';
  return 'bottom';
}

/**
 * read：讀目前的左右安全區；apply：把姿態寫到外面（DOM）。兩者都由外面注入，所以不碰 DOM 也能測。
 * 姿態沒變就不通知訂閱者（旋轉後仍是 bottom 時，整棵 React 樹不必重畫）。
 */
export function createPostureStore(read: () => Insets, apply: (bars: Bars) => void) {
  let current = classifyBars(read());
  apply(current);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (): Bars => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(): void {
      const next = classifyBars(read());
      if (next === current) return;
      current = next;
      apply(next);
      listeners.forEach(l => l());
    },
  };
}

/**
 * 探針：兩個隱形元素，寬度分別吃左右安全區（env() 讀不到數字，只能讓它變成元素尺寸再量）。
 * 用 ResizeObserver 看它們：安全區在「視窗大小沒變」時也會變（WebView 剛掛上視窗時 inset 還是 0、之後才有值；
 * 開合、換邊轉向有時不發 resize），這種情況只有探針的尺寸會動。
 */
function domProbes(onChange: () => void): () => Insets {
  const make = (side: 'left' | 'right') => {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:fixed;top:0;${side}:0;height:1px;visibility:hidden;pointer-events:none;width:env(safe-area-inset-${side})`;
    (document.body ?? document.documentElement).appendChild(probe);
    return probe;
  };
  const left = make('left');
  const right = make('right');
  const ro = new ResizeObserver(onChange);
  ro.observe(left);
  ro.observe(right);
  return () => ({ left: left.getBoundingClientRect().width, right: right.getBoundingClientRect().width });
}

type PostureStore = ReturnType<typeof createPostureStore>;
let store: PostureStore | null = null;

/**
 * 啟動姿態判定（只在 App 內，可重複呼叫）：載入先判一次，之後探針尺寸改變、resize、旋轉、顯示狀態改變、pageshow 都重判。
 * 回到前景（Capacitor resume）由 shell.ts 呼叫 refreshPosture。
 * 旋轉事件觸發當下 env() 可能還是舊值，所以下一個 frame 再讀一次。
 */
export function startPosture(): PostureStore | null {
  if (store) return store;
  if (!isNative()) return null;
  let created: PostureStore | null = null;
  const refresh = () => {
    created?.refresh();
    requestAnimationFrame(() => created?.refresh());
  };
  created = createPostureStore(domProbes(refresh), bars => { document.documentElement.dataset.bars = bars; });
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  store = created;
  return store;
}

export function refreshPosture(): void {
  store?.refresh();
}

const subscribe = (listener: () => void): (() => void) => startPosture()?.subscribe(listener) ?? (() => {});
const snapshot = (): Bars => startPosture()?.getSnapshot() ?? 'bottom';

/** 目前姿態。App 外永遠是 'bottom'。元件用這個決定「軌」或「膠囊」（兩者同一時間只出現一種） */
export function usePosture(): Bars {
  return useSyncExternalStore(subscribe, snapshot, () => 'bottom');
}
