import { Capacitor } from '@capacitor/core';

// 原生殼（Capacitor）偵測。網頁版永遠是 false；在 App 內是 'ios' 或 'android'。
// 只有這一支會被網頁 bundle 載入；其他原生模組都由 shell.ts 動態載入，網頁版不帶。

export type NativePlatform = 'ios' | 'android';

export const isNative = (): boolean => Capacitor.isNativePlatform();

export function nativePlatform(): NativePlatform | null {
  if (!isNative()) return null;
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : null;
}
