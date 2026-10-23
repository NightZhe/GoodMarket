// MAAC Go（漸強實驗室 https://sms.cresclab.com）POST /api/sms/send：門號轉換、請求組裝、回覆解析。純函式，不碰網路與 Deno。
// 依據 https://sms.cresclab.com/openapi.yaml（SmsSendRequest／SmsSendResponse／ErrorResponse）、developers.html 的錯誤碼表與 llms-full.txt（2026-10-21 查證，整理在 .work/phone-otp-auth/t8-maacgo-tests.md）。
import type { Severity } from './mitake.ts';

export const MAACGO_DEFAULT_BASE = 'https://sms.cresclab.com';

/**
 * 只收台灣手機（去掉開頭一個 + 後必須是 8869 開頭共 12 碼），轉成 MAAC Go 吃的 E.164 `+886912345678`（不轉 09）。
 * GoTrue 實測給的是不帶 + 的 886912345678（與三竹同一個來源），兩種都收。
 */
export function toMaacgoNumber(raw: string): string | null {
  const d = raw.startsWith('+') ? raw.slice(1) : raw;
  return /^8869\d{8}$/.test(d) ? `+${d}` : null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);

/**
 * MAACGO_API_BASE（選填）→ 基底網址（不含 /api，函式自己接 /api/sms/send）。沒設 → 正式站。
 * 規則比照三竹的 MITAKE_HOST：沒寫 scheme 補 https://；明寫 http:// 只准 localhost／127.0.0.1／host.docker.internal（本機假伺服器）；
 * 路徑、帳密、查詢字串一律拒絕（回 null）。
 */
export function resolveMaacgoBase(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return MAACGO_DEFAULT_BASE;
  const m = /^(https?):\/\/(.+)$/i.exec(raw.trim());
  const scheme = m ? m[1].toLowerCase() : 'https';
  const rest = (m ? m[2] : raw.trim()).replace(/\/$/, '');
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(rest)) return null;
  if (scheme === 'http' && !LOCAL_HOSTS.has(rest.replace(/:\d+$/, '').toLowerCase())) return null;
  return `${scheme}://${rest}`;
}

export interface MaacgoCreds { base: string; apiKey: string }
export interface MaacgoSendParams { to: string; body: string }

export function buildMaacgoRequest(c: MaacgoCreds, p: MaacgoSendParams): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  return {
    url: `${c.base}/api/sms/send`,
    init: {
      method: 'POST',
      // 金鑰只放 Authorization 標頭：網址與 body 都不帶（網址會進各種 log）
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: p.to, body: p.body, type: 'otp' }),
    },
  };
}

export interface MaacgoOk {
  kind: 'ok';
  status: string;
  messageId: string | undefined;
  segments: number | undefined;
  costCents: number | undefined;
  balanceCents: number | undefined;
}
export interface MaacgoFail {
  kind: 'fail';
  reason: string;
  severity: Severity;
  errorCode?: string;
  messageId?: string;
  balanceCents?: number;
  nccCodes?: string[];
  retryAfter?: number;
  limit?: number;
  used?: number;
  /** 5xx：對方可能已經把簡訊交出去了（log 的 outcome 記 unknown，而不是 failed）。 */
  maybeSent?: boolean;
}
/** 2xx 但看不懂：簡訊可能已寄出。 */
export interface MaacgoUnknown { kind: 'unknown'; reason: string }
export type MaacgoReply = MaacgoOk | MaacgoFail | MaacgoUnknown;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const natural = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
// 對方的字串只在符合「已知安全」的形狀時才進 log，避免 log 被塞東西（換行、驗證碼、金鑰回聲）
const safeId = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);
const safeCode = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z_ ]{1,40}$/.test(v) ? v : undefined);

/** openapi.yaml：SmsSendResponse.status 的 enum 是 queued／sent／delivered／failed。前三個＝MAAC 已受理，算成功；failed 與其他值不算。 */
export const SUCCESS_STATUSES: ReadonlySet<string> = new Set(['queued', 'sent', 'delivered']);

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * HTTP 狀態＋回覆文字 → 結果。分類只決定 log 的 reason 與嚴重度；回給 GoTrue 的內容由呼叫端一律用同一個 200＋502（不洩漏 MAAC 細節，更不透傳 429）。
 * 錯誤碼表（developers.html）：400 to_and_body_required／invalid_tw_phone／ncc_blocked、401 unauthorized、402 insufficient_balance、403 requires scope、
 * 429 rate_limited（limit／used／retry_after）、500 internal_error。
 */
export function parseMaacgoReply(httpStatus: number, text: string): MaacgoReply {
  const j = parseJson(text);
  const body = isObj(j) ? j : {};
  if (httpStatus >= 200 && httpStatus < 300) {
    if (!isObj(j) || typeof j.status !== 'string') return { kind: 'unknown', reason: 'maacgo_unparsable' };
    const messageId = safeId(j.message_id);
    const balanceCents = natural(j.balance_cents);
    if (j.ok === false || j.status === 'failed') return { kind: 'fail', reason: 'maacgo_failed', severity: 'error', messageId, balanceCents };
    if (!SUCCESS_STATUSES.has(j.status)) return { kind: 'unknown', reason: 'maacgo_unparsable' };
    return { kind: 'ok', status: j.status, messageId, segments: natural(j.segments), costCents: natural(j.cost_cents), balanceCents };
  }
  const errorCode = safeCode(body.error);
  const fail = (reason: string, severity: Severity, extra: Partial<MaacgoFail> = {}): MaacgoFail => ({ kind: 'fail', reason, severity, errorCode, ...extra });
  switch (httpStatus) {
    case 400: {
      if (errorCode === 'ncc_blocked') { // 文案被 NCC 規則擋：每一則都寄不出去，要人改範本
        const issues = Array.isArray(body.issues) ? body.issues : [];
        const nccCodes = issues.map((i) => (isObj(i) ? i.code : undefined)).filter((c): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(c)).slice(0, 5);
        return fail('maacgo_ncc_blocked', 'critical', { nccCodes });
      }
      if (errorCode === 'invalid_tw_phone') return fail('maacgo_bad_number', 'info');
      return fail('maacgo_request', 'error');
    }
    case 401: case 403: return fail('maacgo_auth', 'critical');                                 // key 錯／被撤銷／scope 不足
    case 402: return fail('maacgo_billing', 'critical', { balanceCents: natural(body.balance_cents) }); // 餘額不足
    case 429: return fail('maacgo_rate_limited', 'warn', { retryAfter: natural(body.retry_after), limit: natural(body.limit), used: natural(body.used) });
    default:
      return fail(`maacgo_http_${httpStatus}`, 'error', httpStatus >= 500 ? { maybeSent: true } : {});
  }
}
