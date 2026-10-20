// Supabase「Send SMS hook」的處理邏輯：GoTrue 產生 OTP → 呼叫這裡 → 轉給三竹 SmSend。依 spec-mitake.md R-M1～R-M12。
// 所有外部依賴（環境變數、fetch、時間、UUID、log）都由 createHandler 注入，所以可以不連網測試；Deno 專用的部分只在 index.ts。
//
// 與 GoTrue 的介面（本機 GoTrue v2.197.0 實測，見 .work/phone-otp-auth/t5/out/probe-*.txt）：
//  - 成功：200 ＋ Content-Type: application/json ＋ `{}`。200 沒帶 Content-Type 會被 GoTrue 當錯誤（400 hook_payload_invalid_content_type）。
//  - 失敗：GoTrue 只有在「HTTP 200」時才會解析 `{"error":{"http_code":…,"message":…}}` 並把 http_code／message 回給前端；
//    回 4xx／5xx 時 GoTrue 丟掉我們的 body，前端只拿到 500 與英文通用訊息。所以「簡訊沒寄出」一律是
//    HTTP 200 ＋ `{"error":{"http_code":502,"message":"SMS not sent"}}`（固定一句，不帶三竹細節，原因只進 log）。
//    只有簽章失敗（401）、非 POST（405）、body 過大（413）是真的 HTTP 錯誤：那不是 GoTrue 打來的。
//  - GoTrue 整個 hook 總時限 5 秒（逾時前端拿到 422 hook_timeout），所以呼叫三竹的逾時設 3 秒，讓我們在 5 秒內自己回錯誤。
//  - GoTrue 對「連不上」與「429／503 且帶 retry-after」會重打（用新的 webhook-id）→ 會重複寄；所以絕不回 429／503，函式自己也不重試。
import {
  buildSmSendRequest, classifyStatus, maskPhone, parseMitakeReply, renderSmsBody, resolveMitakeBase, toMitakeNumber, type Severity,
} from './mitake.ts';
import { verifyWebhook } from './webhook.ts';

export interface Deps {
  env: (key: string) => string | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  uuid?: () => string;
  /** 預設依嚴重度走 console.log／warn／error，內容是單行 JSON（Supabase Logs 好搜尋）。 */
  log?: (level: Severity, line: string) => void;
}

export const DEFAULT_MITAKE_TIMEOUT_MS = 3000;
export const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LOW_POINT = 100;

const jsonHeaders = { 'Content-Type': 'application/json' };
const ok = () => new Response('{}', { status: 200, headers: jsonHeaders });
const notSent = () => new Response(JSON.stringify({ error: { http_code: 502, message: 'SMS not sent' } }), { status: 200, headers: jsonHeaders });
const plain = (status: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { ...jsonHeaders, ...extra } });

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intEnv = (raw: string | undefined, min: number, max: number, dflt: number) =>
  raw && /^\d{1,6}$/.test(raw) && Number(raw) >= min && Number(raw) <= max ? Number(raw) : dflt;

const defaultLog = (level: Severity, line: string) => {
  if (level === 'info') console.log(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
};

export function createHandler(d: Deps): (req: Request) => Promise<Response> {
  const uuid = d.uuid ?? (() => crypto.randomUUID());
  const sink = d.log ?? defaultLog;

  return async function handle(req: Request): Promise<Response> {
    const started = d.now();
    // log 規則：永不記 OTP、密碼、完整門號、完整 body、secret、簡訊內文、例外訊息。呼叫端只傳「已知安全」的欄位；門號先過 maskPhone。
    const emit = (level: Severity, fields: Record<string, unknown>) =>
      sink(level, JSON.stringify({ fn: 'send-sms', level, ...fields, ms: d.now() - started }));
    const send = (outcome: 'sent' | 'rejected' | 'failed' | 'unknown', level: Severity, fields: Record<string, unknown>) =>
      emit(level, { evt: 'send_sms', outcome, ...fields });

    try {
      if (req.method !== 'POST') return plain(405, 'method not allowed', { Allow: 'POST' });
      const body = await req.text(); // 驗簽要用原始字串
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return plain(413, 'payload too large'); // GoTrue 上限 20KB

      const secrets = d.env('SEND_SMS_HOOK_SECRET');
      if (!secrets) { // 沒設就一律拒絕：不可退化成「沒設就不驗」
        send('rejected', 'critical', { reason: 'no_hook_secret' });
        return plain(401, 'invalid signature');
      }
      const verified = await verifyWebhook({
        secrets, body, nowMs: d.now(),
        id: req.headers.get('webhook-id'), timestamp: req.headers.get('webhook-timestamp'), signature: req.headers.get('webhook-signature'),
      });
      if (!verified) {
        send('rejected', 'warn', { reason: 'bad_signature' });
        return plain(401, 'invalid signature');
      }

      // ── payload ──
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = undefined; }
      if (!isObj(parsed) || !isObj(parsed.sms)) {
        send('rejected', 'warn', { reason: 'bad_payload' });
        return notSent();
      }
      const otp = parsed.sms.otp;
      if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) { // 後台設 6 位；只放行純數字，內文才不會被夾帶別的字
        send('rejected', 'warn', { reason: 'bad_otp' });
        return notSent();
      }
      // 目標門號：sms.phone 是 GoTrue 明確要寄的那支。綁定（updateUser）流程裡 user.phone 是空字串（或舊門號），新門號在 sms.phone／user.new_phone。
      // 沒有 sms.phone 的舊版 GoTrue 才依序退回 user.new_phone、user.phone（備援）。
      const user = isObj(parsed.user) ? parsed.user : {};
      // 只有「沒有 sms.phone 這個欄位」才退回備援；有但格式不對就直接失敗，不拿別的欄位頂替。
      const rawPhone = 'phone' in parsed.sms ? str(parsed.sms.phone) : (str(user.new_phone) ?? str(user.phone));
      if (!rawPhone) {
        send('rejected', 'warn', { reason: 'no_phone' });
        return notSent();
      }
      const to = toMitakeNumber(rawPhone);
      const masked = maskPhone(rawPhone);
      if (!to) { // 伺服器端唯一的「只收台灣」防線（取代 Twilio Geo Permissions）
        send('rejected', 'warn', { reason: 'non_tw_phone', phone: masked });
        return notSent();
      }

      // ── 設定 ──
      const base = resolveMitakeBase(d.env('MITAKE_HOST'));
      const username = d.env('MITAKE_USERNAME');
      const password = d.env('MITAKE_PASSWORD');
      if (!base || !username || !password) {
        send('failed', 'critical', { reason: 'bad_config', missing: [!base && 'MITAKE_HOST', !username && 'MITAKE_USERNAME', !password && 'MITAKE_PASSWORD'].filter(Boolean), phone: masked });
        return notSent();
      }

      // ── 呼叫三竹（不重試）──
      const clientid = uuid();
      const call = buildSmSendRequest({ base, username, password }, { dstaddr: to, smbody: renderSmsBody(otp), clientid });
      const limit = intEnv(d.env('MITAKE_TIMEOUT_MS'), 100, 30_000, DEFAULT_MITAKE_TIMEOUT_MS);
      const ac = new AbortController();
      let timedOut = false;
      const t0 = d.now();
      const timer = setTimeout(() => { timedOut = true; ac.abort(); }, limit);
      let text: string;
      try {
        const res = await d.fetch(call.url, { ...call.init, signal: ac.signal });
        if (res.status !== 200) {
          send('failed', 'error', { reason: `mitake_http_${res.status}`, phone: masked, clientid, mitake_ms: d.now() - t0 });
          return notSent();
        }
        text = await res.text();
      } catch (e) {
        // 逾時或連線失敗：簡訊「可能」已寄出，所以 outcome 是 unknown；使用者再按一次會產生新碼、舊碼作廢
        if (timedOut) send('unknown', 'error', { reason: 'mitake_timeout', timeout_ms: limit, phone: masked, clientid });
        else send('unknown', 'error', { reason: 'mitake_network', error: e instanceof Error ? e.name : 'unknown', phone: masked, clientid });
        return notSent();
      } finally {
        clearTimeout(timer);
      }
      const mitakeMs = d.now() - t0;

      const reply = parseMitakeReply(text);
      if (!reply) {
        send('unknown', 'error', { reason: 'mitake_unparsable', phone: masked, clientid, mitake_ms: mitakeMs });
        return notSent();
      }
      const facts = {
        phone: masked, clientid, msgid: reply.msgid, statuscode: reply.statuscode, account_point: reply.accountPoint,
        sms_point: reply.smsPoint, duplicate: reply.duplicate, mitake_ms: mitakeMs,
      };
      const outcome = classifyStatus(reply.statuscode);
      if (outcome.ok) {
        send('sent', 'info', facts);
        const low = intEnv(d.env('MITAKE_LOW_POINT'), 0, 1_000_000, DEFAULT_LOW_POINT);
        if (reply.accountPoint !== undefined && reply.accountPoint < low) {
          emit('warn', { evt: 'mitake_low_balance', account_point: reply.accountPoint, threshold: low });
        }
        return ok();
      }
      send('failed', outcome.severity, { reason: outcome.reason, ...facts });
      return notSent();
    } catch (e) {
      send('failed', 'critical', { reason: 'unexpected', error: e instanceof Error ? e.name : 'unknown' });
      return notSent();
    }
  };
}
