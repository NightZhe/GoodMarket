// 簡訊再驗證的新鮮度（契約 §4）：session 的 JWT amr 裡 method='otp' 最新一筆的 timestamp（秒）距現在 ≤ 10 分鐘。
// 這裡只是前端的預判，用來「已經驗證過就不要再發一封簡訊」；是否放行永遠以伺服器為準（伺服器擋下就走重新驗證）。

export const STEP_UP_WINDOW_MS = 600_000;
/** 容許時鐘差（契約：不得晚於 now + 1 分鐘） */
const SKEW_MS = 60_000;

/** 取出 JWT payload 的 amr；壞形狀一律回空陣列（當作沒有 otp） */
export function amrOfToken(token: string | null | undefined): { method: string; timestamp: number }[] {
  if (!token) return [];
  try {
    const part = token.split('.')[1];
    if (!part) return [];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const amr = (JSON.parse(json) as { amr?: unknown }).amr;
    if (!Array.isArray(amr)) return [];
    return amr.filter((a): a is { method: string; timestamp: number } =>
      typeof a === 'object' && a !== null && typeof (a as { method?: unknown }).method === 'string' && typeof (a as { timestamp?: unknown }).timestamp === 'number');
  } catch {
    return [];
  }
}

/** 最新一筆 otp 還在有效期內嗎 */
export function otpIsFresh(amr: readonly { method: string; timestamp: number }[], nowMs: number): boolean {
  const last = Math.max(-Infinity, ...amr.filter(a => a.method === 'otp').map(a => a.timestamp * 1000));
  return last >= nowMs - STEP_UP_WINDOW_MS && last <= nowMs + SKEW_MS;
}
