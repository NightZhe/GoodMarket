import { supabase } from '../supabase';
import { withAbortTimeout } from '../rpcTimeout';
import { AccountError, classifyAccountError } from '../account/errors';
import type { ReportReason, ReportTargetType } from './reasons';

// submit_report 的呼叫（介面見 .work/store-prereqs/interface-store-prereqs.md §2.1）。
// 錯誤一律轉成 AccountError：auth＝登入失效、backend_missing＝資料庫未升級、network＝可重試、server＝資料庫中文訊息。

export interface ReportResult {
  id: string;
  /** true＝先前已檢舉過同一目標且站方還沒處理；沒有新增，畫面照樣顯示「已收到檢舉」 */
  duplicate: boolean;
}

/** 送出逾時：到了就取消請求。伺服器端若其實已寫入，使用者重送會得到 duplicate:true */
export const REPORT_TIMEOUT_MS = 15_000;

export async function submitReport(
  type: ReportTargetType, id: string, reason: ReportReason, details: string | null,
): Promise<ReportResult> {
  const { value, timedOut } = await withAbortTimeout(REPORT_TIMEOUT_MS, signal =>
    supabase.rpc('submit_report', {
      p_target_type: type, p_target_id: id, p_reason: reason, p_details: details,
    }).abortSignal(signal));
  if (timedOut || !value) throw new AccountError('timeout', 'network', null);
  if (value.error) throw classifyAccountError(value.error);
  const data = value.data as Partial<ReportResult> | null;
  if (!data || typeof data.id !== 'string' || typeof data.duplicate !== 'boolean') {
    throw new AccountError('bad response', 'server', null);
  }
  return { id: data.id, duplicate: data.duplicate };
}
