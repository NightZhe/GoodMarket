// 賣家中心登出確認後的流程（純邏輯，畫面在 SignOutSheet）。

export const SIGN_OUT_COPY = {
  title: '要登出嗎？',
  description: '只會登出這台裝置，買家端也會一起登出。商品、訂單都還在，下次登入就回來。',
  confirm: '登出',
  busy: '登出中…',
  cancel: '取消',
  done: '已登出',
  failed: '登出失敗，請檢查網路後再試',
} as const;

export type SignOutDeps = {
  /** 只登出這台（scope:'local'）：呼叫端傳 StoreContext 的 signOutBuyer */
  signOut: () => Promise<void>;
  navigate: (to: string, opts: { replace: boolean }) => void;
  toast: (message: string, kind?: 'error') => void;
};

/**
 * 等登出真的完成才導頁（Q5-3：登出後到賣家登入頁 /seller）。失敗（離線等）留在原頁、提示錯誤，仍是登入狀態，不假裝成功（沿用 Account.tsx 的做法）。
 * 回傳是否成功，讓面板決定要不要解除「登出中」。
 */
export async function performSignOut({ signOut, navigate, toast }: SignOutDeps): Promise<boolean> {
  try {
    await signOut();
  } catch {
    toast(SIGN_OUT_COPY.failed, 'error');
    return false;
  }
  navigate('/seller', { replace: true });
  toast(SIGN_OUT_COPY.done);
  return true;
}
