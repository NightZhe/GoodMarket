/**
 * Android 實體返回鍵的覆蓋層堆疊（純函式，不碰 Capacitor，才測得到）。
 * 開著的抽屜／對話框／浮層用 pushNativeBack 登記「返回鍵該做什麼」（通常是關閉自己，等同 Esc），卸載時解除；
 * shell.ts 收到 backButton 先問最上面（最晚登記＝最內層）的那一個，有人接手就不回上一頁。
 * handler 回 false 表示「這次不接手」，會往下一層問；其餘回傳值（含 undefined）都算接手。
 * 網頁版與 iOS 沒有實體返回鍵，登記了也不會被問到；React 元件請用 useNativeBack，網頁版會直接略過。
 */
export type NativeBackHandler = () => boolean | void;

const stack: NativeBackHandler[] = [];

/** 登記返回鍵動作，回傳解除函式（可重複呼叫，只解除自己這一筆） */
export function pushNativeBack(handler: NativeBackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 從最內層往外問；true＝有覆蓋層接手了（殼不該回上一頁） */
export function consumeNativeBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true;
  }
  return false;
}

/** 目前登記中的覆蓋層數（測試與除錯用） */
export const nativeBackDepth = (): number => stack.length;
