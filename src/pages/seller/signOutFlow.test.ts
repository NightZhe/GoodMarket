import { describe, expect, it } from 'vitest';
import { performSignOut, SIGN_OUT_COPY } from './signOutFlow';

function deps(signOut: () => Promise<void>) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      signOut: async () => { calls.push('signOut'); await signOut(); },
      navigate: (to: string, opts: { replace: boolean }) => calls.push(`navigate:${to}:${opts.replace}`),
      toast: (msg: string, kind?: 'error') => calls.push(`toast:${msg}:${kind ?? 'success'}`),
    },
  };
}

describe('performSignOut：確認後的登出流程（Q5-1／Q5-3）', () => {
  it('成功：先等登出完成，再 replace 導到 /seller、提示「已登出」，回傳 true', async () => {
    const t = deps(async () => undefined);
    expect(await performSignOut(t.deps)).toBe(true);
    expect(t.calls).toEqual(['signOut', 'navigate:/seller:true', 'toast:已登出:success']);
  });

  it('失敗（離線等）：不導頁、提示錯誤文案，回傳 false，仍是登入狀態', async () => {
    const t = deps(async () => { throw new Error('network'); });
    expect(await performSignOut(t.deps)).toBe(false);
    expect(t.calls).toEqual(['signOut', 'toast:登出失敗，請檢查網路後再試:error']);
  });
});

describe('確認面板文案（spec 4.3）', () => {
  it('標題與說明', () => {
    expect(SIGN_OUT_COPY.title).toBe('要登出嗎？');
    expect(SIGN_OUT_COPY.description).toBe('只會登出這台裝置，買家端也會一起登出。商品、訂單都還在，下次登入就回來。');
  });
});
