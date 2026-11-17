import { useEffect, useRef } from 'react';
import { isNative } from './platform';
import { pushNativeBack, type NativeBackHandler } from './backStack';

/**
 * 覆蓋層（抽屜、對話框、浮層）掛載期間登記 Android 實體返回鍵的動作，動作通常與 Esc 相同（關閉自己）。
 * active=false 時不登記（例如浮層沒展開）。網頁版與 iOS 不做事（沒有實體返回鍵）。
 * onBack 每次 render 都可以換新的函式：這裡存在 ref 裡，堆疊位置不會因為重新 render 而跑到別的覆蓋層上面。
 */
export function useNativeBack(onBack: NativeBackHandler, active = true): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active || !isNative()) return;
    return pushNativeBack(() => ref.current());
  }, [active]);
}
