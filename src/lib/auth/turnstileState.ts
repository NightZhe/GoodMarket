// Cloudflare Turnstile 的狀態機與按下「傳送」時的決策（design C-2、spec R-15）。純函式，不碰 window。
// 模式：Managed ＋ appearance 'interaction-only'：平常隱形，Cloudflare 判定需要互動時才長出勾選框。

export type TsStatus =
  | 'off'          // 沒有 sitekey，或手機登入關閉：不載入、照常可送
  | 'loading'      // ① 腳本載入、widget 背景挑戰中（看不到任何東西）
  | 'ready'        // ① 通過：token 在記憶體裡，看不到任何東西
  | 'interactive'  // ② 需要互動：勾選框出現
  | 'failed'       // ③ 失敗可重試：error-callback
  | 'timeout'      // ④ 逾時：互動挑戰沒在時限內完成，Cloudflare 已自己重設，仍要使用者勾選
  | 'unavailable'; // ⑤ 載入不了：腳本被擋／離線，或按了傳送等 10 秒還沒 token

export type TsEvent =
  | { type: 'token' }              // callback
  | { type: 'interactive' }        // before-interactive-callback
  | { type: 'error' }              // error-callback
  | { type: 'timeout' }            // timeout-callback
  | { type: 'expired' }            // expired-callback：token 300 秒到期
  | { type: 'script-failed' }      // 腳本載入失敗
  | { type: 'stuck' }              // 按了傳送，等了 TOKEN_WAIT_MS 還沒 token
  | { type: 'retry' }              // 使用者按「再試一次」「重新載入安全驗證」
  | { type: 'consumed' };          // token 用掉了（單次有效），已 reset 重新取得

/** R-15 第 4 點：token 還沒好就按了傳送，最多等這麼久（假設 A-20） */
export const TOKEN_WAIT_MS = 10_000;

export function tsReduce(s: TsStatus, e: TsEvent): TsStatus {
  if (s === 'off') return 'off';
  switch (e.type) {
    case 'token': return 'ready';
    case 'interactive': return s === 'ready' ? 'ready' : 'interactive';
    case 'error': return 'failed';
    case 'timeout': return 'timeout';
    case 'expired': return 'loading';
    case 'script-failed':
    case 'stuck': return 'unavailable';
    case 'retry':
    case 'consumed': return 'loading';
  }
}

export type TokenDecision = 'send' | 'wait' | 'interaction' | 'failed' | 'unavailable';

/** 使用者按下「傳送驗證碼」時：直接送、等 token、請他先勾選、或顯示失敗 */
export function tokenDecision(s: TsStatus): TokenDecision {
  switch (s) {
    case 'off':
    case 'ready': return 'send';
    case 'loading': return 'wait';
    case 'interactive':
    case 'timeout': return 'interaction';
    case 'failed': return 'failed';
    case 'unavailable': return 'unavailable';
  }
}

/** 官方 flexible 最小寬 300；容器更窄（縮放 200%）就改 compact（150×140）。用量到的寬度判斷，不是 CSS */
export const turnstileSize = (containerWidth: number): 'flexible' | 'compact' => (containerWidth < 300 ? 'compact' : 'flexible');
