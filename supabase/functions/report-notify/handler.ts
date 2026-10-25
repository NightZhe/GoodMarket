// 檢舉通知（spec R-K7～R-K10、N17、工單 B-4）：資料庫觸發器（pg_net）在 reports insert 提交後 POST { id } 到這裡 →
// 驗共用密鑰 → 讀該筆檢舉（service role）→ 尚未通知才寄信給站方信箱 → 把結果記回 reports。
// 所有外部依賴（環境變數、資料庫存取、SMTP、時間）都由 createHandler 注入，所以可以不連網測試；Deno 專用的部分只在 index.ts。
//
// 回應規則：
//  - 401：沒帶或帶錯密鑰（含「伺服器沒設密鑰」：一律拒絕，不可退化成不驗證）。不寄信、不讀資料庫。
//  - 405／413／400：不是合法的呼叫（不是 pg_net 打來的）。
//  - 其餘一律 HTTP 200 ＋ { ok, status | error }：寄信失敗、設定缺漏、資料庫錯誤都不丟 5xx
//    （R-K10 與團隊約定：不讓呼叫端把失敗當成要重試）。檢舉列的 notify_* 欄位記錄結果。
//  - 檢舉 id 不存在 → 404（不寄）；已通知（notified_at 有值）→ 200 already_notified（不寄）。
// log 規則：單行 JSON；不記密鑰、SMTP 帳密、信件內容、收件人、檢舉人資料；例外只記類別與截斷後的訊息（密碼已遮罩）。
import { buildMime, buildSubject, buildText, isUuid, parseMailbox, parseRecipients, BRAND, type ReportRow } from './mail.ts';
import type { SmtpConfig } from './smtp.ts';

export interface ReportStore {
  /** 讀一筆檢舉；不存在回 null。不得回傳 reporter_id。 */
  get(id: string): Promise<ReportRow | null>;
  /** 評價所屬商品 id（評價已被刪除或查不到回 null）。 */
  reviewProductId(reviewId: string): Promise<string | null>;
  /** 寄出成功：只在 notified_at 仍為 null 時寫 notified_at、notify_attempts、清空 notify_error。 */
  markSent(row: ReportRow, atIso: string): Promise<void>;
  /** 寄出失敗：notify_attempts+1、notify_error＝已截斷的訊息。 */
  markFailed(row: ReportRow, error: string): Promise<void>;
}

export interface Deps {
  env: (key: string) => string | undefined;
  store: ReportStore;
  send: (cfg: SmtpConfig, rawMessage: string) => Promise<void>;
  now: () => number;
  uuid?: () => string;
  log?: (level: 'info' | 'warn' | 'error', line: string) => void;
}

export const MAX_BODY_BYTES = 4 * 1024;
export const MAX_ERROR_CHARS = 500; // reports_notify_valid：notify_error ≤ 500
const jsonHeaders = { 'Content-Type': 'application/json' };
const respond = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extra } });

/** 常數時間比較：兩邊都先雜湊成等長，再逐位元組 XOR（不因第一個不同字元而提早結束）。 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** 錯誤訊息 → 可寫進 notify_error 的短字串：遮掉 SMTP 密碼／帳號、去控制字元、截斷。 */
export function describeError(e: unknown, secrets: Array<string | undefined>): string {
  let m = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error';
  for (const s of secrets) if (s && s.length >= 3) m = m.split(s).join('***');
  m = m.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return (m || 'unknown error').slice(0, MAX_ERROR_CHARS);
}

export function createHandler(d: Deps): (req: Request) => Promise<Response> {
  const uuid = d.uuid ?? (() => crypto.randomUUID());
  const sink = d.log ?? ((level, line) => (level === 'info' ? console.log(line) : level === 'warn' ? console.warn(line) : console.error(line)));

  return async function handle(req: Request): Promise<Response> {
    const started = d.now();
    const emit = (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) =>
      sink(level, JSON.stringify({ fn: 'report-notify', level, ...fields, ms: d.now() - started }));

    try {
      if (req.method !== 'POST') return respond(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });

      // 1) 共用密鑰（R-K10）。在讀 body、碰資料庫之前先驗。
      const secret = d.env('REPORT_NOTIFY_SECRET');
      if (!secret) { emit('error', { evt: 'auth', outcome: 'rejected', reason: 'no_secret_configured' }); return respond(401, { ok: false, error: 'unauthorized' }); }
      const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
      if (!m || !(await safeEqual(m[1], secret))) {
        emit('warn', { evt: 'auth', outcome: 'rejected', reason: 'bad_token' });
        return respond(401, { ok: false, error: 'unauthorized' });
      }

      // 2) body：{ id: uuid }
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return respond(413, { ok: false, error: 'payload_too_large' });
      let id: unknown;
      try { id = (JSON.parse(raw) as { id?: unknown } | null)?.id; } catch { id = undefined; }
      if (!isUuid(id)) return respond(400, { ok: false, error: 'bad_request' });

      // 3) 只寄「資料庫裡存在且尚未通知」的檢舉
      const row = await d.store.get(id);
      if (!row) { emit('info', { evt: 'notify', outcome: 'not_found', report_id: id }); return respond(404, { ok: false, error: 'not_found' }); }
      if (row.notified_at) { emit('info', { evt: 'notify', outcome: 'already_notified', report_id: id }); return respond(200, { ok: true, status: 'already_notified' }); }

      // 4) 設定（收件人固定來自 secret，不接受 body 指定）
      const host = d.env('SMTP_HOST');
      const portRaw = d.env('SMTP_PORT');
      const user = d.env('SMTP_USER') || undefined;
      const pass = d.env('SMTP_PASS') || undefined;
      const from = parseMailbox(d.env('SMTP_FROM'));
      const to = parseRecipients(d.env('REPORT_NOTIFY_TO'));
      const port = portRaw && /^\d{1,5}$/.test(portRaw) && Number(portRaw) >= 1 && Number(portRaw) <= 65535 ? Number(portRaw) : undefined;
      const bad = [!host && 'SMTP_HOST', !port && 'SMTP_PORT', !from && 'SMTP_FROM', !to && 'REPORT_NOTIFY_TO', (!user) !== (!pass) && 'SMTP_USER/SMTP_PASS'].filter(Boolean);
      if (bad.length > 0 || !host || !port || !from || !to) {
        return await fail(row, `not_configured: ${bad.join(', ')}`, 'not_configured');
      }

      // 5) 組信＋寄信
      let reviewProductId: string | null = null;
      if (row.target_type === 'review') {
        try { reviewProductId = await d.store.reviewProductId(row.target_id); } catch { reviewProductId = null; } // 查不到就退回店家連結，不擋寄信
      }
      const mime = buildMime({
        from: from.name ? from : { name: BRAND, addr: from.addr },
        to,
        subject: buildSubject(row),
        text: buildText(row, reviewProductId),
        date: new Date(d.now()),
        messageId: uuid(),
      });
      try {
        await d.send({ host, port, user, pass, from: from.addr, to, helo: 'goodmarket-report-notify' }, mime);
      } catch (e) {
        return await fail(row, describeError(e, [pass, user]), 'send_failed');
      }

      // 6) 記成功。信已寄出，記錄失敗也不能回錯（避免被當成沒寄而重打）。
      try {
        await d.store.markSent(row, new Date(d.now()).toISOString());
      } catch (e) {
        emit('error', { evt: 'notify', outcome: 'sent_but_not_recorded', report_id: id, error: describeError(e, [pass, user]) });
        return respond(200, { ok: true, status: 'sent', recorded: false });
      }
      emit('info', { evt: 'notify', outcome: 'sent', report_id: id });
      return respond(200, { ok: true, status: 'sent' });
    } catch (e) {
      // 資料庫讀取失敗等：回 200＋error，原因只進 log
      emit('error', { evt: 'notify', outcome: 'internal', error: describeError(e, []) });
      return respond(200, { ok: false, error: 'internal' });
    }

    async function fail(row: ReportRow, message: string, outcome: string): Promise<Response> {
      try { await d.store.markFailed(row, message.slice(0, MAX_ERROR_CHARS)); }
      catch (e) { emit('error', { evt: 'notify', outcome: 'failure_not_recorded', report_id: row.id, error: describeError(e, []) }); }
      emit('warn', { evt: 'notify', outcome, report_id: row.id, error: message });
      return respond(200, { ok: false, error: outcome });
    }
  };
}
