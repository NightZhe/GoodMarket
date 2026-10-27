import { useSyncExternalStore } from 'react';
import { isNative } from '../native/platform';

// 姿態判定（iPhone Duo 適配，decisions 四-1、design-spec §2.1）。
// 系統欄在左右側直立時（外蓋、展開橫向、書本、Split View），左右安全區「不對稱」：
// 只看 right − left 的差值，不看機型、視窗寬度、orientation。結果寫到 <html data-bars>，CSS 與元件共用同一份。
//   side-right：右側有系統欄（Duo 常態）｜side-left：左側有｜bottom：其餘（一般 iPhone 直橫、Duo 內直、佇立）
// 只在 App 內判定：網頁版（Safari）自己有工具列，永遠是 bottom。
//
// 側邊姿態另有「軌的版型」（rail，寫到 <html data-rail>）：iPhone Duo 外螢幕三個姿態的狀態區（相機＋島＋時間）位置不同，
// 軌的起點與底緣因此不同（decisions 第七節實測、X9）。數字在 index.css 的 html[data-rail=…]，這裡只負責分類。

export type Bars = 'bottom' | 'side-left' | 'side-right';
export type Insets = { left: number; right: number };

/**
 * 直立軌的版型（只在側邊姿態有意義）：
 *   outer-portrait：外直，狀態區到 141 → 軌起點 ≥ 153｜outer-landscape-primary：外橫、系統欄在左，只有相機 → 起點 ≥ 78
 *   outer-landscape-secondary：外橫、系統欄在右，相機在欄底 y 400–436 → 起點貼頂 12、底緣留 74（X9）｜default：其餘（內橫 116、Split View…）
 */
export type RailProfile = 'default' | 'outer-portrait' | 'outer-landscape-primary' | 'outer-landscape-secondary';

/** 讀到的環境。left／right 是必要的；其餘缺了就當成「不知道」，版型退回 default */
export type Reading = Insets & { width?: number; height?: number; orientation?: string };

/** 外螢幕的視窗寬上限（實測 466×678／678×466）。`screen` 在內螢幕也回報外螢幕尺寸，不能用，只能看視窗寬（T0、decisions X9） */
export const OUTER_MAX_WIDTH = 678;

/** 判定門檻（pt）。推估值：小於觸控目標 44 的一半，不會誤判對稱的瀏海機，也不會漏掉 Duo 的 73–84。T0 量到外蓋／半折實測值後以實測為準 */
export const SIDE_THRESHOLD = 24;

export function classifyBars({ left, right }: Insets): Bars {
  if (right - left >= SIDE_THRESHOLD) return 'side-right';
  if (left - right >= SIDE_THRESHOLD) return 'side-left';
  return 'bottom';
}

/**
 * 軌的版型。判定用 screen.orientation.type＋視窗寬（env() 看不出相機在哪一端）；讀不到 orientation 時由視窗長寬與系統欄的側推
 * （實測：外橫 primary 的欄在左、secondary 在右）。orientation 與欄的側對不上就不猜，退回 default（起點 116、底 34，最保守）
 */
export function classifyRail({ bars, orientation, width, height }: { bars: Bars; orientation?: string; width?: number; height?: number }): RailProfile {
  if (bars === 'bottom' || width === undefined || height === undefined || width > OUTER_MAX_WIDTH) return 'default';
  const landscape = orientation ? orientation.startsWith('landscape') : width > height;
  if (!landscape) return 'outer-portrait';
  const type = orientation ?? (bars === 'side-right' ? 'landscape-secondary' : 'landscape-primary');
  if (type === 'landscape-secondary' && bars === 'side-right') return 'outer-landscape-secondary';
  if (type === 'landscape-primary' && bars === 'side-left') return 'outer-landscape-primary';
  return 'default';
}

/**
 * read：讀目前的左右安全區；apply：把姿態寫到外面（DOM）。兩者都由外面注入，所以不碰 DOM 也能測。
 * 姿態沒變就不通知訂閱者（旋轉後仍是 bottom 時，整棵 React 樹不必重畫）。
 */
export function createPostureStore(read: () => Reading, apply: (bars: Bars, rail: RailProfile) => void) {
  const classify = (): { bars: Bars; rail: RailProfile } => {
    const reading = read();
    const bars = classifyBars(reading);
    return { bars, rail: classifyRail({ bars, ...reading }) };
  };
  let { bars: current, rail: currentRail } = classify();
  apply(current, currentRail);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (): Bars => current,
    getRail: (): RailProfile => currentRail,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(): void {
      const next = classify();
      if (next.bars === current && next.rail === currentRail) return;
      current = next.bars;
      currentRail = next.rail;
      apply(current, currentRail);
      listeners.forEach(l => l());
    },
  };
}

/**
 * 探針：兩個隱形元素，寬度分別吃左右安全區（env() 讀不到數字，只能讓它變成元素尺寸再量）。
 * 用 ResizeObserver 看它們：安全區在「視窗大小沒變」時也會變（WebView 剛掛上視窗時 inset 還是 0、之後才有值；
 * 開合、換邊轉向有時不發 resize），這種情況只有探針的尺寸會動。
 */
function domProbes(onChange: () => void): () => Reading {
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
  return () => ({
    left: left.getBoundingClientRect().width,
    right: right.getBoundingClientRect().width,
    width: window.innerWidth,
    height: window.innerHeight,
    orientation: screen.orientation?.type,
  });
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
  created = createPostureStore(domProbes(refresh), (bars, rail) => {
    document.documentElement.dataset.bars = bars;
    document.documentElement.dataset.rail = rail;
  });
  window.addEventListener('resize', refresh);
  screen.orientation?.addEventListener('change', refresh);
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
