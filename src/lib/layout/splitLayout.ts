import { useSyncExternalStore } from 'react';
import { isNative } from '../native/platform';

// 「桌機雙欄」判定：與 Tailwind 的 md: 同一條件（index.css：不是 App 且視窗 ≥ 48rem）。
// 賣家聊聊的雙欄要由 JS 決定（返回鈕要不要給、頂欄要不要藏），不能只靠 CSS 的 md:。

export const SPLIT_QUERY = '(min-width: 48rem)';

export function isSplitLayout(native: boolean): boolean {
  if (native || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SPLIT_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(SPLIT_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useSplitLayout(): boolean {
  return useSyncExternalStore(subscribe, () => isSplitLayout(isNative()), () => false);
}
