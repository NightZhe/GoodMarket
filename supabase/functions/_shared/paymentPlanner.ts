// 多店授權狀態機：給定「這次嘗試的所有授權」目前的狀態，決定下一步。純函式，不做任何 I/O。
// 執行端（paymentRunner）每做完一步就把結果寫回資料庫再重新規劃，所以行程在任何地方中斷，
// 補償程序拿同一份資料呼叫同一個函式，都會收斂到同一個結果（可重入）。
//
// 原則（D19／D20，spec K-32）：
//   · 全部授權成功 → 決定「請款」，逐筆關帳；任何一筆失敗 → 決定「放棄」，把已授權的全部放掉。
//   · 決定一旦寫入資料庫就不再翻面，除了一種情況：請款途中某筆反覆關帳失敗 → 改成放棄（寧可全退，不留一家請款一家沒請款）。
//   · 還有結果不明的授權（calling）時，不能收尾：它可能已授權，放著就是一筆沒人管的佔額。
import { CALLING_STALE_MS, MAX_ACTION_FAILURES, type AuthRow, type GroupView, type PlanStep } from './paymentTypes.ts';

const TW_OFFSET_MS = 8 * 3600_000;

/** 綠界文件：「每日自動關帳」開啟時，每天 20:15～20:30 請勿執行請退款 API（35642）。前後各留 5 分鐘。台灣時間 20:10–20:35。 */
export function isDoActionBlackout(nowMs: number): boolean {
  const minuteOfDay = Math.floor((((nowMs + TW_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);
  return minuteOfDay >= 20 * 60 + 10 && minuteOfDay < 20 * 60 + 35;
}

const isStale = (a: AuthRow, now: number) => a.callStartedAt != null && now - a.callStartedAt >= CALLING_STALE_MS;

function planCalling(calling: AuthRow[], now: number): PlanStep {
  const stale = calling.filter((a) => isStale(a, now));
  return stale.length > 0 ? { type: 'refresh', auths: stale } : { type: 'wait', reason: 'in_flight' };
}

export function planStep(group: GroupView, auths: AuthRow[], now: number): PlanStep {
  const by = (s: AuthRow['state']) => auths.filter((a) => a.state === s);
  const pending = by('pending');
  const calling = by('calling');
  const authorized = by('authorized');
  const captured = by('captured');

  if (group.decision === null) {
    if (by('declined').length > 0) return { type: 'decide', decision: 'abandon' };
    if (calling.length > 0) return planCalling(calling, now);
    if (pending.length > 0) return { type: 'authorize', auths: pending };
    return { type: 'decide', decision: 'capture' }; // 全部 authorized（空集合也不會走到這裡：呼叫端保證至少一筆）
  }

  if (group.decision === 'capture') {
    if (authorized.some((a) => a.actionFailures >= MAX_ACTION_FAILURES)) return { type: 'decide', decision: 'abandon' };
    if (authorized.length > 0) {
      return isDoActionBlackout(now) ? { type: 'wait', reason: 'blackout' } : { type: 'capture', auths: authorized };
    }
    return { type: 'finalize', outcome: 'paid' };
  }

  // decision === 'abandon'
  if (pending.length > 0) return { type: 'skip', auths: pending };
  if (calling.length > 0) return planCalling(calling, now);
  const live = [...authorized, ...captured];
  if (live.length === 0) return { type: 'finalize', outcome: 'failed' };
  const actionable = live.filter((a) => a.actionFailures < MAX_ACTION_FAILURES);
  if (actionable.length === 0) return { type: 'wait', reason: 'stuck' };
  if (isDoActionBlackout(now)) return { type: 'wait', reason: 'blackout' };
  return { type: 'abandon', auths: actionable };
}
