// deno-lint-ignore-file no-explicit-any
// HTTP 共用：CORS、統一的回應格式 { ok:true, ... } / { ok:false, error:{ code, message } }、登入驗證。
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadConfig } from './env.ts';

export class PayError extends Error {
  /** extra：放進 error 物件的附加欄位（例如 retryAfter），不得含卡號、BindCardID、金鑰 */
  constructor(readonly code: string, message: string, readonly status = 400, readonly extra?: Record<string, unknown>) { super(message); }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = loadConfig().allowedOrigins;
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });

export const admin = (): SupabaseClient => {
  const c = loadConfig();
  return createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

export interface AuthedUser { id: string; email: string | null; phone: string | null; jwt: string }

/** 驗證 Authorization: Bearer <使用者 JWT>。函式以 --no-verify-jwt 部署，這裡自己驗，才能回統一格式的 401。 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new PayError('NOT_AUTHENTICATED', '請先登入', 401);
  const c = loadConfig();
  const { data, error } = await createClient(c.supabaseUrl, c.anonKey, { auth: { persistSession: false } }).auth.getUser(jwt);
  if (error || !data.user) throw new PayError('NOT_AUTHENTICATED', '登入已過期，請重新登入', 401);
  return { id: data.user.id, email: data.user.email ?? null, phone: data.user.phone ?? null, jwt };
}

/** 以使用者身分呼叫 RPC（auth.uid() 有值）。 */
export const asUser = (jwt: string): SupabaseClient => {
  const c = loadConfig();
  return createClient(c.supabaseUrl, c.anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
};

export async function readJson(req: Request): Promise<Record<string, any>> {
  try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
}

/** 包住 handler：OPTIONS、POST 限定、PayError 轉統一格式、其餘例外一律 500（訊息不含細節，細節只進日誌且不含卡號／金鑰）。 */
export function serve(name: string, handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    try {
      if (req.method !== 'POST') throw new PayError('METHOD_NOT_ALLOWED', '不支援的請求', 405);
      return await handler(req);
    } catch (e) {
      if (e instanceof PayError) return json(req, { ok: false, error: { ...e.extra, code: e.code, message: e.message } }, e.status);
      console.error(`[${name}] unexpected`, e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
      return json(req, { ok: false, error: { code: 'INTERNAL', message: '系統忙碌，請稍後再試' } }, 500);
    }
  });
}
