import { toAccountError } from '../account/errors';
import type { OrderStatus } from '../../types';

// 買家「我的訂單」退貨資訊：哪些訂單有入口、讀取失敗時面板要顯示哪一種（設計 6.1、6.4；決策 D9、N6）。純函式。

/** 只有運送中與已完成的訂單有入口（D9）；待出貨、已取消沒有。不看日期 */
export const hasReturnInfoEntry = (status: OrderStatus): boolean => status === 'shipping' || status === 'completed';

/**
 * 面板的失敗種類：
 * - offline：明確離線，不發請求（可重試）
 * - failed：網路或伺服器失敗（可重試；不可講成「賣家尚未提供」，R-L19）
 * - unavailable：資料庫還沒套 migration（R-L17、N6）
 * - not_available：這張單已不在運送中／已完成（RETURN_INFO_NOT_AVAILABLE）
 * - not_found：ORDER_NOT_FOUND
 * - auth：登入過期
 */
export type ReturnInfoFailure = 'offline' | 'failed' | 'unavailable' | 'not_available' | 'not_found' | 'auth';

export function returnInfoFailure(e: unknown): ReturnInfoFailure {
  const err = toAccountError(e);
  if (err.kind === 'backend_missing') return 'unavailable';
  if (err.code === 'RETURN_INFO_NOT_AVAILABLE') return 'not_available';
  if (err.code === 'ORDER_NOT_FOUND') return 'not_found';
  if (err.kind === 'auth') return 'auth';
  return 'failed';
}

/** 這幾種是「再試也沒用」的結果，面板不放重試鈕 */
export const returnInfoRetryable = (f: ReturnInfoFailure): boolean => f === 'offline' || f === 'failed';
