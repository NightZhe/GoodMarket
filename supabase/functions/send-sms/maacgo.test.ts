import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type Deps } from './handler.ts';
import {
  buildMaacgoRequest, MAACGO_DEFAULT_BASE, parseMaacgoReply, resolveMaacgoBase, toMaacgoNumber,
} from './maacgo.ts';

// 回覆格式依據 https://sms.cresclab.com/openapi.yaml（SmsSendResponse、ErrorResponse）與 developers.html 的錯誤碼表（2026-10-21 抓取）。
const okBody = (over: Record<string, unknown> = {}) => JSON.stringify({ ok: true, message_id: 'sms_abc123', status: 'sent', segments: 1, cost_cents: 78, balance_cents: 4922, ...over });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('門號：台灣手機 → E.164（MAAC Go 吃 +886…，不轉 09）', () => {
  it.each(['+886912345678', '886912345678'])('%s → +886912345678', (p) => {
    expect(toMaacgoNumber(p)).toBe('+886912345678');
  });
  it.each(['0912345678', '+88612345678', '+886812345678', '+8869123456789', '+14155550123', '+85291234567', '+886 912345678', '++886912345678', ''])(
    '拒絕 %j（只收台灣行動門號）', (p) => { expect(toMaacgoNumber(p)).toBeNull(); });
});

describe('MAACGO_API_BASE 解析', () => {
  it('沒設或空字串 → 預設 https://sms.cresclab.com', () => {
    expect(MAACGO_DEFAULT_BASE).toBe('https://sms.cresclab.com');
    expect(resolveMaacgoBase(undefined)).toBe('https://sms.cresclab.com');
    expect(resolveMaacgoBase('')).toBe('https://sms.cresclab.com');
  });
  it.each([
    ['https://proxy.example.com', 'https://proxy.example.com'],
    ['https://proxy.example.com:8443/', 'https://proxy.example.com:8443'],
    ['http://localhost:9978', 'http://localhost:9978'],
    ['http://127.0.0.1:9978', 'http://127.0.0.1:9978'],
    ['http://host.docker.internal:9978', 'http://host.docker.internal:9978'],
    ['sms.example.com', 'https://sms.example.com'], // 沒寫 scheme 一律補 https
  ])('接受 %s', (raw, want) => { expect(resolveMaacgoBase(raw)).toBe(want); });
  it.each([
    'http://sms.example.com', 'http://sms.cresclab.com', 'http://localhost.evil.com', 'ftp://x.example.com',
    'https://x.example.com/api', 'https://user:pw@x.example.com', 'https://x.example.com?a=1', 'https://x y', 'javascript:alert(1)',
  ])('拒絕 %s（http 只准本機、不准路徑／帳密／查詢）', (raw) => { expect(resolveMaacgoBase(raw)).toBeNull(); });
});

describe('請求組裝', () => {
  const req = buildMaacgoRequest({ base: 'https://sms.cresclab.com', apiKey: 'sk_live_TESTKEY' }, { to: '+886912345678', body: '【好物集】你的驗證碼是 123456，5 分鐘內有效。請勿提供給任何人。' });
  it('POST {base}/api/sms/send、Bearer、JSON', () => {
    expect(req.url).toBe('https://sms.cresclab.com/api/sms/send');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers).toEqual({ Authorization: 'Bearer sk_live_TESTKEY', 'Content-Type': 'application/json' });
  });
  it('body 只有 to／body／type=otp 三個欄位（不帶 from、team）', () => {
    expect(JSON.parse(req.init.body)).toEqual({
      to: '+886912345678', body: '【好物集】你的驗證碼是 123456，5 分鐘內有效。請勿提供給任何人。', type: 'otp',
    });
  });
  it('金鑰只在 Authorization 標頭，不在網址、不在 body', () => {
    expect(req.url).not.toContain('TESTKEY');
    expect(req.init.body).not.toContain('TESTKEY');
  });
});

describe('回覆解析：2xx', () => {
  it.each(['queued', 'sent', 'delivered'])('status=%s 算成功，並取出 message_id／segments／cost_cents／balance_cents', (status) => {
    expect(parseMaacgoReply(200, okBody({ status }))).toEqual({
      kind: 'ok', status, messageId: 'sms_abc123', segments: 1, costCents: 78, balanceCents: 4922,
    });
  });
  it('developers.html 範例（沒有 ok 欄位）也算成功', () => {
    const t = JSON.stringify({ message_id: 'sms_abc123', status: 'delivered', segments: 1, cost_cents: 78, balance_cents: 4922 });
    expect(parseMaacgoReply(200, t)).toMatchObject({ kind: 'ok', status: 'delivered' });
  });
  it('缺數字欄位時照樣成功，欄位為 undefined（不編造）', () => {
    expect(parseMaacgoReply(200, JSON.stringify({ status: 'sent' }))).toEqual({
      kind: 'ok', status: 'sent', messageId: undefined, segments: undefined, costCents: undefined, balanceCents: undefined,
    });
  });
  it('message_id 長得怪（含換行、過長、不是字串）就不當 log 欄位', () => {
    for (const id of ['a\nb', 'x'.repeat(200), 12345, { a: 1 }]) {
      expect(parseMaacgoReply(200, okBody({ message_id: id }))).toMatchObject({ kind: 'ok', messageId: undefined });
    }
  });
  it('數字欄位不是有限整數（字串、負數、小數、NaN）→ undefined', () => {
    expect(parseMaacgoReply(200, okBody({ segments: '1', cost_cents: -5, balance_cents: 1.5 }))).toMatchObject({
      kind: 'ok', segments: undefined, costCents: undefined, balanceCents: undefined,
    });
  });
  it('status=failed → 失敗（錢包會自動退款）', () => {
    expect(parseMaacgoReply(200, okBody({ status: 'failed' }))).toEqual({ kind: 'fail', reason: 'maacgo_failed', severity: 'error', messageId: 'sms_abc123', balanceCents: 4922 });
  });
  it('ok:false → 失敗', () => {
    expect(parseMaacgoReply(200, okBody({ ok: false, status: 'sent' }))).toMatchObject({ kind: 'fail', reason: 'maacgo_failed' });
  });
  it.each([
    ['stop（退訂，不是送達）', okBody({ status: 'stop' })],
    ['status 缺', JSON.stringify({ message_id: 'x' })],
    ['status 不是字串', okBody({ status: 1 })],
    ['status 大小寫不同（不猜）', okBody({ status: 'SENT' })],
    ['HTML', '<html>maintenance</html>'],
    ['空白', ''],
    ['JSON 但是陣列', '[]'],
    ['JSON 但是字串', '"ok"'],
  ])('%s → unknown（簡訊可能已寄出）', (_n, t) => {
    expect(parseMaacgoReply(200, t)).toEqual({ kind: 'unknown', reason: 'maacgo_unparsable' });
  });
  it('201／204 之類的 2xx 也走同一套解析', () => {
    expect(parseMaacgoReply(201, okBody())).toMatchObject({ kind: 'ok' });
    expect(parseMaacgoReply(204, '')).toEqual({ kind: 'unknown', reason: 'maacgo_unparsable' });
  });
});

describe('回覆解析：錯誤', () => {
  it('400 ncc_blocked → critical（文案被擋＝每一則都寄不出），並取出 issues 的 code（只收大寫代碼）', () => {
    const t = JSON.stringify({ error: 'ncc_blocked', issues: [{ level: 'block', code: 'SHORTENER', reason: 'bit.ly is on NCC blocklist' }, { level: 'block', code: 'bad code with 驗證碼 123456' }] });
    expect(parseMaacgoReply(400, t)).toEqual({ kind: 'fail', reason: 'maacgo_ncc_blocked', severity: 'critical', errorCode: 'ncc_blocked', nccCodes: ['SHORTENER'] });
  });
  it('400 invalid_tw_phone → info；to_and_body_required／其他 400 → error', () => {
    expect(parseMaacgoReply(400, '{"error":"invalid_tw_phone"}')).toMatchObject({ reason: 'maacgo_bad_number', severity: 'info' });
    expect(parseMaacgoReply(400, '{"error":"to_and_body_required"}')).toMatchObject({ reason: 'maacgo_request', severity: 'error' });
    expect(parseMaacgoReply(400, 'whatever')).toMatchObject({ reason: 'maacgo_request', severity: 'error' });
  });
  it('401、403（scope 不足）→ critical maacgo_auth', () => {
    expect(parseMaacgoReply(401, '{"error":"unauthorized"}')).toMatchObject({ kind: 'fail', reason: 'maacgo_auth', severity: 'critical', errorCode: 'unauthorized' });
    expect(parseMaacgoReply(403, '{"error":"requires scope"}')).toMatchObject({ reason: 'maacgo_auth', severity: 'critical' });
  });
  it('402 insufficient_balance → critical maacgo_billing；餘額取自 balance_cents，topup_url 不收', () => {
    const r = parseMaacgoReply(402, JSON.stringify({ error: 'insufficient_balance', balance_cents: 30, required_cents: 78, topup_url: 'https://sms.cresclab.com/app.html#wallet?topup=1' }));
    expect(r).toEqual({ kind: 'fail', reason: 'maacgo_billing', severity: 'critical', errorCode: 'insufficient_balance', balanceCents: 30 });
  });
  it('429 rate_limited → warn，取出 retry_after／limit／used（只記數字）', () => {
    expect(parseMaacgoReply(429, '{"error":"rate_limited","limit":200,"used":200,"retry_after":3600}')).toEqual({
      kind: 'fail', reason: 'maacgo_rate_limited', severity: 'warn', errorCode: 'rate_limited', retryAfter: 3600, limit: 200, used: 200,
    });
  });
  it('429 沒有 JSON 也分類得出來；retry_after 若不是數字就丟掉', () => {
    expect(parseMaacgoReply(429, 'Too Many Requests')).toEqual({ kind: 'fail', reason: 'maacgo_rate_limited', severity: 'warn' });
    expect(parseMaacgoReply(429, '{"error":"rate_limited","retry_after":"soon"}')).toMatchObject({ reason: 'maacgo_rate_limited', retryAfter: undefined });
  });
  it('500／502／503 → unknown 結果（簡訊可能已寄出）reason=maacgo_http_<碼>，severity error', () => {
    expect(parseMaacgoReply(500, '{"error":"internal_error"}')).toMatchObject({ kind: 'fail', reason: 'maacgo_http_500', severity: 'error', maybeSent: true });
    expect(parseMaacgoReply(503, '')).toMatchObject({ reason: 'maacgo_http_503', maybeSent: true });
  });
  it('其他狀態碼（404、422、302）→ maacgo_http_<碼>，error', () => {
    expect(parseMaacgoReply(404, '{"error":"not_found"}')).toMatchObject({ reason: 'maacgo_http_404', severity: 'error' });
    expect(parseMaacgoReply(302, '')).toMatchObject({ reason: 'maacgo_http_302' });
  });
  it('errorCode 只收 [a-z_ ] 的短字串（對方 body 不原樣進 log）', () => {
    expect(parseMaacgoReply(400, JSON.stringify({ error: '驗證碼 123456 \n injected' }))).toMatchObject({ errorCode: undefined });
    expect(parseMaacgoReply(400, JSON.stringify({ error: 'x'.repeat(100) }))).toMatchObject({ errorCode: undefined });
  });
});

// ───────────────────────── handler 整合（SMS_PROVIDER=maacgo）─────────────────────────
const KEY = Buffer.from('0123456789abcdef0123456789abcdef');
const HOOK_SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW_MS = 1_800_000_000_000;
const OTP = '734915';
const API_KEY = 'sk_live_FAKE_not_a_real_key';
const FAILED = { error: { http_code: 502, message: 'SMS not sent' } };
const sign = (id: string, ts: number, body: string) => 'v1,' + createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64');
const payload = (over: { phone?: unknown; otp?: unknown } = {}) =>
  JSON.stringify({ metadata: { name: 'send_sms' }, user: { id: 'u-1', phone: '886912345678' }, sms: { otp: over.otp ?? OTP, phone: over.phone ?? '886912345678' } });
const signedReq = (body: string) => {
  const ts = Math.floor(NOW_MS / 1000);
  return new Request('https://x.example/functions/v1/send-sms', {
    method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sign('msg_1', ts, body) }, body,
  });
};

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;
let out: { method: 'log' | 'warn' | 'error'; line: string }[];
let env: Record<string, string | undefined>;
const make = () => createHandler({ env: (k) => env[k], fetch: fetchMock as unknown as Deps['fetch'], now: () => NOW_MS, uuid: () => 'u' });
const logs = () => out.map((o) => o.line);
const logObjs = () => out.map((o) => JSON.parse(o.line) as Record<string, unknown>);
const sendSmsLogs = () => logObjs().filter((o) => o.evt === 'send_sms');
const expectFailed = async (res: Response) => {
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('retry-after')).toBeNull();
  expect(await res.json()).toEqual(FAILED);
};

beforeEach(() => {
  env = { SEND_SMS_HOOK_SECRET: HOOK_SECRET, SMS_PROVIDER: 'maacgo', MAACGO_API_KEY: API_KEY };
  fetchMock = vi.fn<FetchFn>(async () => json(200, okBody()));
  out = [];
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((s: unknown) => { out.push({ method: m, line: String(s) }); });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('handler：SMS_PROVIDER=maacgo 成功路徑', () => {
  it('回 200＋JSON `{}`；只打一次 MAAC Go；請求長相正確、沒有碰三竹', async () => {
    const res = await make()(signedReq(payload()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sms.cresclab.com/api/sms/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+886912345678', body: `【好物集】你的驗證碼是 ${OTP}，5 分鐘內有效。請勿提供給任何人。`, type: 'otp',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('帶 + 的門號（官方文件格式）也行，送出去一樣是 +886…', async () => {
    await make()(signedReq(payload({ phone: '+886987654321' })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).to).toBe('+886987654321');
  });
  it.each(['queued', 'sent', 'delivered'])('status=%s → 成功', async (status) => {
    fetchMock.mockResolvedValueOnce(json(200, okBody({ status })));
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'sent', status });
  });
  it('log：provider、message_id、segments、cost_cents、balance_cents、遮罩門號；單行 JSON、走 console.log', async () => {
    await make()(signedReq(payload()));
    expect(sendSmsLogs()).toEqual([expect.objectContaining({
      fn: 'send-sms', level: 'info', provider: 'maacgo', outcome: 'sent', phone: '+8869****678',
      message_id: 'sms_abc123', status: 'sent', segments: 1, cost_cents: 78, balance_cents: 4922, ms: 0, maacgo_ms: 0,
    })]);
    expect(out.every((o) => o.method === 'log')).toBe(true);
    for (const l of logs()) expect(l).not.toContain('\n');
  });
  it('餘額低於 SMS_LOW_BALANCE_CENTS（預設 1000）多一行 warn maacgo_low_balance；剛好等於不警告', async () => {
    fetchMock.mockResolvedValueOnce(json(200, okBody({ balance_cents: 999 })));
    await make()(signedReq(payload()));
    expect(logObjs().find((o) => o.evt === 'maacgo_low_balance')).toMatchObject({ level: 'warn', provider: 'maacgo', balance_cents: 999, threshold_cents: 1000 });
    expect(out.find((o) => o.line.includes('maacgo_low_balance'))!.method).toBe('warn');
    out = [];
    fetchMock.mockResolvedValueOnce(json(200, okBody({ balance_cents: 1000 })));
    await make()(signedReq(payload()));
    expect(logObjs().some((o) => o.evt === 'maacgo_low_balance')).toBe(false);
    out = []; env.SMS_LOW_BALANCE_CENTS = '5000';
    fetchMock.mockResolvedValueOnce(json(200, okBody({ balance_cents: 4922 })));
    await make()(signedReq(payload()));
    expect(logObjs().find((o) => o.evt === 'maacgo_low_balance')).toMatchObject({ threshold_cents: 5000 });
  });
  it('回覆沒有 balance_cents → 不警告也不編造', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'sent' }));
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(logObjs().some((o) => o.evt === 'maacgo_low_balance')).toBe(false);
  });
  it('SMS_LOW_BALANCE_CENTS 不是數字 → 用預設 1000', async () => {
    env.SMS_LOW_BALANCE_CENTS = 'abc';
    fetchMock.mockResolvedValueOnce(json(200, okBody({ balance_cents: 500 })));
    await make()(signedReq(payload()));
    expect(logObjs().find((o) => o.evt === 'maacgo_low_balance')).toMatchObject({ threshold_cents: 1000 });
  });
  it('MAACGO_API_BASE 可覆蓋（本機假伺服器）', async () => {
    env.MAACGO_API_BASE = 'http://host.docker.internal:9978';
    await make()(signedReq(payload()));
    expect(fetchMock.mock.calls[0][0]).toBe('http://host.docker.internal:9978/api/sms/send');
  });
});

describe('handler：MAAC Go 失敗一律 200＋502，永遠不把 429 等狀態透傳給 GoTrue', () => {
  it.each([
    ['400 ncc_blocked', 400, { error: 'ncc_blocked', issues: [{ level: 'block', code: 'SHORTENER', reason: 'x' }] }, 'maacgo_ncc_blocked', 'critical', 'failed'],
    ['400 invalid_tw_phone', 400, { error: 'invalid_tw_phone' }, 'maacgo_bad_number', 'info', 'failed'],
    ['401 unauthorized', 401, { error: 'unauthorized' }, 'maacgo_auth', 'critical', 'failed'],
    ['402 insufficient_balance', 402, { error: 'insufficient_balance', balance_cents: 30, topup_url: 'https://x' }, 'maacgo_billing', 'critical', 'failed'],
    ['403 requires scope', 403, { error: 'requires scope' }, 'maacgo_auth', 'critical', 'failed'],
    ['429 rate_limited（帶 retry_after）', 429, { error: 'rate_limited', limit: 200, used: 200, retry_after: 3600 }, 'maacgo_rate_limited', 'warn', 'failed'],
    ['500 internal_error', 500, { error: 'internal_error' }, 'maacgo_http_500', 'error', 'unknown'],
    ['503', 503, 'Service Unavailable', 'maacgo_http_503', 'error', 'unknown'],
    ['200 status=failed', 200, { status: 'failed', message_id: 'sms_f1' }, 'maacgo_failed', 'error', 'failed'],
    ['200 格式壞', 200, '<html>x</html>', 'maacgo_unparsable', 'error', 'unknown'],
  ])('%s', async (_n, st, body, reason, level, outcome) => {
    fetchMock.mockResolvedValueOnce(json(st, body as never, st === 429 ? { 'retry-after': '3600' } : {}));
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).toHaveBeenCalledTimes(1); // 不重試
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', outcome, reason, level, phone: '+8869****678' });
  });
  it('429：回給 GoTrue 的是 200（不是 429）、沒有 retry-after 標頭，GoTrue 不會重打；log 有 retry_after', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited', limit: 200, used: 200, retry_after: 3600 }, { 'retry-after': '3600' }));
    const res = await make()(signedReq(payload()));
    expect(res.status).toBe(200);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendSmsLogs()[0]).toMatchObject({ reason: 'maacgo_rate_limited', retry_after: 3600, limit: 200, used: 200 });
  });
  it('ncc_blocked 的 log 帶 issues 的代碼（SHORTENER），不帶 reason 原文', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'ncc_blocked', issues: [{ level: 'block', code: 'SHORTENER', reason: 'echo 734915 body' }] }));
    await make()(signedReq(payload()));
    expect(sendSmsLogs()[0]).toMatchObject({ error_code: 'ncc_blocked', ncc_codes: ['SHORTENER'] });
    expect(logs().join('')).not.toContain('echo');
  });
  it('402 餘額不足：log 帶 balance_cents；錯誤 body 不洩漏 topup_url／餘額', async () => {
    fetchMock.mockResolvedValueOnce(json(402, { error: 'insufficient_balance', balance_cents: 30, topup_url: 'https://sms.cresclab.com/app.html#wallet?topup=1' }));
    const res = await make()(signedReq(payload()));
    expect(await res.text()).toBe(JSON.stringify(FAILED));
    expect(sendSmsLogs()[0]).toMatchObject({ balance_cents: 30 });
    expect(logs().join('')).not.toContain('topup');
  });
  it('連線失敗（fetch 丟例外）→ maacgo_network，只記例外名稱，不重試', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED 10.0.0.1:443 ' + API_KEY));
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs().join('\n')).not.toMatch(/ECONNREFUSED|10\.0\.0\.1|sk_live/);
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', outcome: 'unknown', reason: 'maacgo_network', error: 'TypeError' });
  });
});

describe('handler：MAAC Go 逾時（3 秒、不重試）', () => {
  const untilFetched = async () => {
    for (let i = 0; i < 200 && fetchMock.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalled();
  };
  const hang = (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
    init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });
  it('預設 3 秒：2.999 秒還沒 abort、3 秒 abort → 200＋502；只呼叫一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(hang);
    const p = make()(signedReq(payload()));
    await untilFetched();
    const signal = fetchMock.mock.calls[0][1].signal!;
    await vi.advanceTimersByTimeAsync(2999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await expectFailed(await p);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', outcome: 'unknown', reason: 'maacgo_timeout', level: 'error', timeout_ms: 3000 });
  });
  it('MAACGO_TIMEOUT_MS 可覆寫（演練用）；回覆讀到一半逾時也算逾時', async () => {
    env.MAACGO_TIMEOUT_MS = '100';
    fetchMock.mockImplementation(async (_u, init) => new Response(new ReadableStream({
      start(c) { init.signal!.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
    }), { status: 200 }));
    await expectFailed(await make()(signedReq(payload())));
    expect(sendSmsLogs()[0]).toMatchObject({ reason: 'maacgo_timeout', timeout_ms: 100 });
  });
});

describe('handler：MAAC Go 設定與輸入檢查', () => {
  it.each([
    ['MAACGO_API_KEY 缺', { MAACGO_API_KEY: undefined }, ['MAACGO_API_KEY']],
    ['MAACGO_API_KEY 空字串', { MAACGO_API_KEY: '' }, ['MAACGO_API_KEY']],
    ['MAACGO_API_BASE 是 http://（非本機）', { MAACGO_API_BASE: 'http://sms.example.com' }, ['MAACGO_API_BASE']],
    ['MAACGO_API_BASE 帶路徑', { MAACGO_API_BASE: 'https://sms.cresclab.com/api' }, ['MAACGO_API_BASE']],
  ])('%s → 200＋502、critical bad_config、不呼叫 MAAC Go', async (_n, over, missing) => {
    Object.assign(env, over);
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', outcome: 'failed', reason: 'bad_config', level: 'critical', missing });
  });
  it('MAAC Go 不需要三竹那三組 secret；三竹三組不影響 MAAC Go', async () => {
    Object.assign(env, { MITAKE_HOST: 'x.example.com', MITAKE_USERNAME: 'u', MITAKE_PASSWORD: 'p' });
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/sms/send');
  });
  it.each(['+14155550123', '+85291234567', '886212345678', '0912345678'])('非台灣門號 %s → 不呼叫 MAAC Go', async (p) => {
    await expectFailed(await make()(signedReq(payload({ phone: p }))));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', outcome: 'rejected', reason: 'non_tw_phone' });
  });
  it('簽章錯誤仍是 401，不呼叫 MAAC Go', async () => {
    const req = new Request('https://x/', { method: 'POST', body: payload() });
    expect((await make()(req)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handler：MAAC Go 的 log 規則（永不記 OTP、金鑰、完整門號、簡訊內文）', () => {
  it('跑過所有路徑後，log 與回應都搜不到敏感字串', async () => {
    const all: string[] = [];
    const h = make();
    const send = async (req: Request) => { const r = await h(req); all.push(await r.clone().text()); };
    await send(signedReq(payload()));
    for (const [st, b] of [[400, { error: 'ncc_blocked', issues: [{ code: 'X', reason: OTP }] }], [401, { error: 'unauthorized', echo: API_KEY }], [402, { error: 'insufficient_balance', balance_cents: 3, topup_url: 'https://t' }],
      [429, { error: 'rate_limited', retry_after: 9 }], [500, 'boom ' + OTP], [200, 'garbage ' + OTP], [200, { status: 'failed' }]] as const) {
      fetchMock.mockResolvedValueOnce(json(st, b as never)); await send(signedReq(payload()));
    }
    fetchMock.mockRejectedValueOnce(new TypeError('boom ' + API_KEY)); await send(signedReq(payload()));
    await send(signedReq(payload({ phone: '+14155550123' })));
    await send(signedReq(payload({ otp: 'abc' })));
    env.MAACGO_API_KEY = ''; await send(signedReq(payload()));
    const text = logs().join('\n') + '\n' + all.join('\n');
    for (const s of [OTP, API_KEY, 'not_a_real_key', 'sk_live', '912345678', '886912345678', '0912345678', '4155550123', '你的驗證碼', '請勿提供給任何人', 'whsec_', KEY.toString('base64'), 'topup', 'Bearer']) {
      expect(text, `不該出現：${s}`).not.toContain(s);
    }
    expect(logs().length).toBeGreaterThan(10);
    for (const l of logs()) { expect(l).not.toContain('\n'); expect(() => JSON.parse(l)).not.toThrow(); }
  });
});
