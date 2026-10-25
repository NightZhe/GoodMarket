// 檢舉通知 Edge Function（工單 B-4）。部署：npx supabase functions deploy report-notify --no-verify-jwt
// （呼叫端是資料庫的 pg_net，帶的是共用密鑰不是使用者 JWT；驗證在 handler.ts 自己做。）
// 環境變數（Supabase secrets；值不進版控、不進日誌）：
//   REPORT_NOTIFY_SECRET  共用密鑰（資料庫 report_notify_config.shared_secret 要填同一個值）
//   REPORT_NOTIFY_TO      收件信箱（站方）；可用逗號分隔最多 5 個
//   SMTP_HOST / SMTP_PORT 例：smtp.gmail.com / 465。465＝隱含 TLS；其他埠先走明碼，伺服器有 STARTTLS 才升級
//                         （Edge Function 禁止連出 25、587 埠，正式站請用 465）
//   SMTP_USER / SMTP_PASS 登入帳密（Gmail：應用程式密碼）。兩個都不設＝不登入（只給本機測試用的 Mailpit；沒有 TLS 時有設帳密會被拒絕）
//   SMTP_FROM             寄件人，`a@b.c` 或 `好物集 <a@b.c>`；只給位址時顯示名稱用「好物集」
// SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由平台自動注入。
// 邏輯在 handler.ts／mail.ts／smtp.ts（可在 Node 下以 vitest 測試）；這裡只負責接上 Deno。
import { createHandler, type ReportStore } from './handler.ts';
import type { ReportRow } from './mail.ts';
import { sendViaSmtp, type Conn, type SmtpTransport } from './smtp.ts';

function wrap(c: Deno.Conn): Conn {
  return {
    async read() {
      const buf = new Uint8Array(4096);
      const n = await c.read(buf);
      return n === null ? null : buf.slice(0, n);
    },
    async write(data) {
      let off = 0;
      while (off < data.length) off += await c.write(data.subarray(off));
    },
    close() { try { c.close(); } catch { /* 已關閉 */ } },
  };
}

// 保留原始 Deno.Conn 以便 STARTTLS 升級
const raw = new WeakMap<Conn, Deno.Conn>();
const transport: SmtpTransport = {
  async connect(hostname, port, tls) {
    const c = tls ? await Deno.connectTls({ hostname, port }) : await Deno.connect({ hostname, port });
    const w = wrap(c);
    raw.set(w, c);
    return w;
  },
  async startTls(conn, hostname) {
    const c = raw.get(conn);
    if (!c) throw new Error('startTls: unknown connection');
    // deno-lint-ignore no-explicit-any
    const t = await (Deno as any).startTls(c as Deno.TcpConn, { hostname });
    const w = wrap(t);
    raw.set(w, t);
    return w;
  },
};

const supabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status} ${path.split('?')[0]}`);
  return res;
}

// 註：不讀 reporter_id（連 select 都不列），通知信不可能帶到檢舉人資料。
const COLS = 'id,target_type,target_id,target_label,target_shop_id,reason,details,created_at,notified_at,notify_attempts';
const store: ReportStore = {
  async get(id) {
    const rows = (await (await rest(`reports?id=eq.${id}&select=${COLS}`)).json()) as ReportRow[];
    return rows[0] ?? null;
  },
  async reviewProductId(reviewId) {
    const rows = (await (await rest(`product_reviews?id=eq.${reviewId}&select=product_id`)).json()) as Array<{ product_id: string }>;
    return rows[0]?.product_id ?? null;
  },
  async markSent(row, atIso) {
    await rest(`reports?id=eq.${row.id}&notified_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ notified_at: atIso, notify_attempts: row.notify_attempts + 1, notify_error: null }),
    });
  },
  async markFailed(row, error) {
    await rest(`reports?id=eq.${row.id}&notified_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ notify_attempts: row.notify_attempts + 1, notify_error: error }),
    });
  },
};

Deno.serve(createHandler({
  env: (k) => Deno.env.get(k),
  store,
  send: (cfg, rawMessage) => sendViaSmtp(transport, cfg, rawMessage),
  now: () => Date.now(),
}));
