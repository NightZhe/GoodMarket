import { Capacitor } from '@capacitor/core';

// 原生殼（Capacitor）偵測。網頁版永遠是 false；在 App 內是 'ios' 或 'android'。
// 網頁 bundle 會載入這一支與 sessionStore.ts（它只在 App 內被呼叫，外掛本身仍是動態 import）；
// 其他原生模組都由 shell.ts 動態載入，網頁版不帶。

export type NativePlatform = 'ios' | 'android';

export const isNative = (): boolean => Capacitor.isNativePlatform();

export function nativePlatform(): NativePlatform | null {
  if (!isNative()) return null;
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : null;
}
