import { describe, expect, it, vi } from 'vitest';
import { consumeNativeBack, nativeBackDepth, pushNativeBack } from './backStack';

describe('backStack：Android 返回鍵的覆蓋層堆疊', () => {
  it('沒有覆蓋層時不接手（殼會回上一頁）', () => {
    expect(nativeBackDepth()).toBe(0);
    expect(consumeNativeBack()).toBe(false);
  });

  it('最晚登記（最內層）的先被問到；接手後外層不會被叫', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const offOuter = pushNativeBack(outer);
    const offInner = pushNativeBack(inner);
    expect(consumeNativeBack()).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    offInner();
    expect(consumeNativeBack()).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
    offOuter();
    expect(nativeBackDepth()).toBe(0);
  });

  it('回 false 表示不接手，往下一層問；全部不接手就回 false', () => {
    const outer = vi.fn(() => false);
    const inner = vi.fn(() => false);
    const off1 = pushNativeBack(outer);
    const off2 = pushNativeBack(inner);
    expect(consumeNativeBack()).toBe(false);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    off2(); off1();
  });

  it('解除函式只拿掉自己那一筆，重複呼叫無害', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = pushNativeBack(a);
    const offB = pushNativeBack(b);
    offA(); offA();
    expect(nativeBackDepth()).toBe(1);
    expect(consumeNativeBack()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    offB();
    expect(nativeBackDepth()).toBe(0);
  });
});
