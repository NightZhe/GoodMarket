import type { ImportCallErrorCode } from '../../types';

/** 呼叫層錯誤碼（error.hint）：重試也不會好，匯入必須停下來（6.0） */
const CALL_CODES: readonly ImportCallErrorCode[] = [
  'NOT_AUTHENTICATED', 'NO_SHOP', 'INVALID_PAYLOAD', 'IMPORT_LIMIT_EXCEEDED',
  'BATCH_TOO_LARGE', 'IMPORT_NOT_FOUND', 'IMPORT_CLOSED',
];

/**
 * 匯入呼叫失敗。
 * - `code` 有值：後端明確拒絕（不可重試，畫面顯示「匯入無法繼續」）
 * - `code` 為 null：網路、逾時、5xx 等暫時性問題（可重送、可「重新嘗試」）
 */
export class ImportCallError extends Error {
  readonly code: ImportCallErrorCode | null;

  constructor(message: string, code: ImportCallErrorCode | null) {
    super(message);
    this.name = 'ImportCallError';
    this.code = code;
  }

  get retryable(): boolean {
    return this.code === null;
  }
}

/** supabase-js 回傳的 error 物件形狀（PostgrestError 或網路錯誤） */
export interface RpcErrorLike {
  message: string;
  hint?: string | null;
  code?: string | null;
}

const isCallCode = (s: string | null | undefined): s is ImportCallErrorCode =>
  s != null && (CALL_CODES as readonly string[]).includes(s);

/** 後端 exception 的 hint 是機器代碼；JWT 過期等同未登入；其餘一律視為暫時性問題 */
export function toCallError(err: RpcErrorLike): ImportCallError {
  if (isCallCode(err.hint)) return new ImportCallError(err.message, err.hint);
  if (err.code === 'PGRST301' || /jwt expired/i.test(err.message)) {
    return new ImportCallError(err.message, 'NOT_AUTHENTICATED');
  }
  return new ImportCallError(err.message, null);
}

/** 呼叫層錯誤碼 → 白話說明（design-t1 2.3「呼叫層錯誤碼」） */
export function callErrorExplanation(code: ImportCallErrorCode): string {
  switch (code) {
    case 'NOT_AUTHENTICATED': return '登入已過期，請重新登入後，再匯入同一批檔案';
    case 'NO_SHOP': return '找不到你的商店，請先開店';
    case 'IMPORT_NOT_FOUND':
    case 'IMPORT_CLOSED': return '這次匯入已經結束或找不到，請回到步驟 1 重新開始';
    case 'INVALID_PAYLOAD':
    case 'IMPORT_LIMIT_EXCEEDED':
    case 'BATCH_TOO_LARGE': return '匯入資料有誤，請回到步驟 1 重新放入檔案';
  }
}
