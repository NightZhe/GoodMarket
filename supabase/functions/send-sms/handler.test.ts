import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type Deps } from './handler.ts';

// ── 測試夾具：全部是假值。簽章由 Node 的 createHmac 算（與實作的 WebCrypto 獨立）。──
const KEY = Buffer.from('0123456789abcdef0123456789abcdef');
const HOOK_SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW_MS = 1_800_000_000_000;
const OTP = '734915';
const PASSWORD = 'pw-secret-XYZ';
const UUID = '11111111-2222-4333-8444-555555555555';
const FAILED = { error: { http_code: 502, message: 'SMS not sent' } };

const sign = (id: string, ts: number, body: string, key = KEY) =>
  'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

// GoTrue v2.197.0 實測的 payload 形狀：sms.phone 與 user.phone 都「不帶 +」；綁定（updateUser）時 user.phone 是空字串、user.new_phone 才是新門號
const payload = (over: { phone?: unknown; otp?: unknown; userPhone?: unknown; newPhone?: unknown } = {}) => {
  const sms: Record<string, unknown> = {};
  if (over.otp !== null) sms.otp = over.otp ?? OTP;
  if (over.phone !== null) sms.phone = over.phone ?? '886912345678';
  const user: Record<string, unknown> = { id: 'u-1', phone: over.userPhone ?? '886912345678' };
  if (over.newPhone !== undefined) user.new_phone = over.newPhone;
  return JSON.stringify({ metadata: { name: 'send_sms' }, user, sms });
};

function signedReq(body: string, o: { method?: string; ts?: number; key?: Buffer; headers?: Record<string, string> } = {}) {
  const ts = o.ts ?? Math.floor(NOW_MS / 1000);
  return new Request('https://x.example/functions/v1/send-sms', {
    method: o.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sign('msg_1', ts, body, o.key), ...o.headers },
    body: o.method === 'GET' ? undefined : body,
  });
}

const mitakeText = (code: string, extra = '') => `[${UUID}]\nmsgid=#000000013\nstatuscode=${code}\nAccountPoint=126\nsmsPoint=1\n${extra}`;
const okReply = () => new Response(mitakeText('1'), { status: 200 });

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;
let out: { method: 'log' | 'warn' | 'error'; line: string }[];
let env: Record<string, string | undefined>;

const make = () => createHandler({
  env: (k) => env[k], fetch: fetchMock as unknown as Deps['fetch'], now: () => NOW_MS, uuid: () => UUID,
});
const logs = () => out.map((o) => o.line);
const logObjs = () => out.map((o) => JSON.parse(o.line) as Record<string, unknown>);
const sendSmsLogs = () => logObjs().filter((o) => o.evt === 'send_sms');
const dstaddr = (i = 0) => new URLSearchParams(fetchMock.mock.calls[i][1].body as string).get('dstaddr');

beforeEach(() => {
  env = { SEND_SMS_HOOK_SECRET: HOOK_SECRET, MITAKE_HOST: 'api.example.com', MITAKE_USERNAME: 'user1', MITAKE_PASSWORD: PASSWORD };
  fetchMock = vi.fn<FetchFn>(async () => okReply());
  out = [];
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((s: unknown) => { out.push({ method: m, line: String(s) }); });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** 所有「簡訊沒寄出」的失敗，GoTrue 看到的都長一樣：HTTP 200＋JSON＋502 錯誤 body（GoTrue 只讀 200 的 body；本機 v2.197.0 實測）。 */
const expectFailed = async (res: Response) => {
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('retry-after')).toBeNull();
  expect(await res.json()).toEqual(FAILED);
};

describe('成功路徑', () => {
  it('寄出：200、JSON `{}`（GoTrue 要求 200 必須有 JSON Content-Type）', async () => {
    const res = await make()(signedReq(payload()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('三竹請求：URL、標頭、參數、內文、clientid；網址沒有帳密', async () => {
    await make()(signedReq(payload()));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/b2c/mtk/SmSend?CharsetURL=UTF-8');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      username: 'user1', password: PASSWORD, dstaddr: '0912345678',
      smbody: `【好物集】你的驗證碼是 ${OTP}，5 分鐘內有效。請勿提供給任何人。`,
      clientid: UUID, vldtime: '300', smsPointFlag: '1',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('clientid 預設用 crypto.randomUUID（36 字 UUID，每次不同）', async () => {
    const h = createHandler({ env: (k) => env[k], fetch: fetchMock as unknown as Deps['fetch'], now: () => NOW_MS });
    await h(signedReq(payload())); await h(signedReq(payload()));
    const ids = fetchMock.mock.calls.map((c) => new URLSearchParams(c[1].body as string).get('clientid'));
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('門號格式：帶 + 的（文件寫的格式）也行', async () => {
    await make()(signedReq(payload({ phone: '+886912345678', userPhone: '+886912345678' })));
    expect(dstaddr()).toBe('0912345678');
  });

  it('綁定流程：user.phone 是空字串，目標門號在 sms.phone → 寄到新門號', async () => {
    await make()(signedReq(payload({ userPhone: '', newPhone: '886987654321', phone: '886987654321' })));
    expect(dstaddr()).toBe('0987654321');
  });

  it('門號優先序：sms.phone 先；沒有 sms.phone 才退回 user.new_phone，再退回 user.phone', async () => {
    await make()(signedReq(payload({ phone: '886911111111', userPhone: '886922222222', newPhone: '886933333333' })));
    expect(dstaddr(0)).toBe('0911111111');
    await make()(signedReq(payload({ phone: null, userPhone: '', newPhone: '886987654322' })));
    expect(dstaddr(1)).toBe('0987654322');
    await make()(signedReq(payload({ phone: null, userPhone: '886987654323' })));
    expect(dstaddr(2)).toBe('0987654323');
  });

  it.each(['0', '1', '2', '4'])('statuscode=%s 都算成功', async (c) => {
    fetchMock.mockResolvedValueOnce(new Response(mitakeText(c)));
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'sent', statuscode: c });
  });

  it('log：成功行有遮罩門號、clientid、msgid、account_point、sms_point、ms，且是單行 JSON、走 console.log', async () => {
    await make()(signedReq(payload()));
    expect(sendSmsLogs()).toEqual([expect.objectContaining({
      fn: 'send-sms', level: 'info', outcome: 'sent', phone: '+8869****678', clientid: UUID, msgid: '#000000013',
      statuscode: '1', account_point: 126, sms_point: 1, duplicate: false, ms: 0, mitake_ms: 0,
    })]);
    expect(out.every((o) => o.method === 'log')).toBe(true);
    for (const l of logs()) expect(l).not.toContain('\n');
  });

  it('點數低於 MITAKE_LOW_POINT（預設 100）多一行 warn mitake_low_balance；剛好等於不警告', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[1]\nmsgid=a\nstatuscode=1\nAccountPoint=99\n'));
    await make()(signedReq(payload()));
    expect(logObjs().find((o) => o.evt === 'mitake_low_balance')).toMatchObject({ level: 'warn', account_point: 99, threshold: 100 });
    expect(out.find((o) => o.line.includes('mitake_low_balance'))!.method).toBe('warn');
    out = [];
    fetchMock.mockResolvedValueOnce(new Response('[1]\nmsgid=a\nstatuscode=1\nAccountPoint=100\n'));
    await make()(signedReq(payload()));
    expect(logObjs().some((o) => o.evt === 'mitake_low_balance')).toBe(false);
    out = []; env.MITAKE_LOW_POINT = '500';
    await make()(signedReq(payload())); // 126 < 500
    expect(logObjs().find((o) => o.evt === 'mitake_low_balance')).toMatchObject({ threshold: 500 });
  });
});

describe('簽章（401）與請求外形', () => {
  it('缺標頭、簽章錯、過期都回 401＋固定訊息，且不呼叫三竹', async () => {
    const body = payload();
    const noHeaders = new Request('https://x/', { method: 'POST', body });
    const bad = signedReq(body, { key: Buffer.from('another-key-another-key-another-k') });
    const old = signedReq(body, { ts: Math.floor(NOW_MS / 1000) - 301 });
    for (const r of [noHeaders, bad, old]) {
      const res = await make()(r);
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await res.json()).toEqual({ error: { http_code: 401, message: 'invalid signature' } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs().filter((o) => o.outcome === 'rejected' && o.reason === 'bad_signature')).toHaveLength(3);
  });

  it('body 被改（驗簽用原始字串）→ 401', async () => {
    const body = payload();
    const tampered = new Request(signedReq(body), { body: body.replace(OTP, '000000') });
    expect((await make()(tampered)).status).toBe(401);
  });

  it('多把 secret（「|」分隔）：新舊任一把簽的都收', async () => {
    env.SEND_SMS_HOOK_SECRET = `v1,whsec_${Buffer.from('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz').toString('base64')}|${HOOK_SECRET}`;
    expect((await make()(signedReq(payload()))).status).toBe(200);
  });

  it('函式沒設 SEND_SMS_HOOK_SECRET：一律 401（不可退化成「沒設就不驗」），記 critical，不寄', async () => {
    delete env.SEND_SMS_HOOK_SECRET;
    const res = await make()(signedReq(payload()));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'rejected', reason: 'no_hook_secret', level: 'critical' });
  });

  it('只收 POST（GET → 405，不驗簽、不呼叫三竹）', async () => {
    const res = await make()(signedReq(payload(), { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('body 超過 64KB 直接拒絕（413），不驗簽、不解析、不呼叫三竹', async () => {
    const big = payload() + ' '.repeat(65 * 1024);
    const res = await make()(signedReq(big));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    const exact = JSON.stringify({ sms: { phone: '886912345678', otp: OTP }, pad: 'x'.repeat(64 * 1024 - 60) });
    expect(new TextEncoder().encode(exact).length).toBeLessThanOrEqual(64 * 1024);
    expect((await make()(signedReq(exact))).status).toBe(200); // 64KB 以內照收
  });
});

describe('payload 檢查（一律 200＋502 失敗，不呼叫三竹）', () => {
  it.each([
    ['不是 JSON', 'not json', 'bad_payload'],
    ['JSON 但是陣列', '[]', 'bad_payload'],
    ['sms 不是物件', JSON.stringify({ user: { phone: '886912345678' }, sms: 'x' }), 'bad_payload'],
    ['缺 sms.otp', payload({ otp: null }), 'bad_otp'],
    ['otp 5 碼', payload({ otp: '12345' }), 'bad_otp'],
    ['otp 7 碼', payload({ otp: '1234567' }), 'bad_otp'],
    ['otp 不是數字', payload({ otp: '12ab56' }), 'bad_otp'],
    ['otp 帶換行（不能讓它混進簡訊內文）', payload({ otp: '123456\n' }), 'bad_otp'],
    ['otp 不是字串', payload({ otp: 123456 }), 'bad_otp'],
    ['完全沒有門號', payload({ phone: null, userPhone: '' }), 'no_phone'],
    ['門號不是字串（數字型別）', payload({ phone: 886912345678 }), 'no_phone'],
  ])('%s', async (_n, body, reason) => {
    await expectFailed(await make()(signedReq(body)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'rejected', reason });
  });
});

describe('門號限制：只支援台灣手機', () => {
  it.each(['+14155550123', '+85291234567', '886212345678', '+88612345678', '886912', '+8869123456789', 'abc', '0912345678', '+886 912345678'])(
    '拒絕 %s，不寄', async (p) => {
      await expectFailed(await make()(signedReq(payload({ phone: p, userPhone: p }))));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'rejected', reason: 'non_tw_phone' });
    });
});

describe('設定檢查', () => {
  it.each([
    ['MITAKE_HOST 缺', { MITAKE_HOST: undefined }],
    ['MITAKE_HOST 是 http://（非本機）', { MITAKE_HOST: 'http://api.example.com' }],
    ['MITAKE_HOST 帶路徑', { MITAKE_HOST: 'api.example.com/b2c' }],
    ['MITAKE_USERNAME 缺', { MITAKE_USERNAME: undefined }],
    ['MITAKE_PASSWORD 缺', { MITAKE_PASSWORD: '' }],
  ])('%s → 失敗、critical bad_config、不呼叫三竹', async (_n, over) => {
    Object.assign(env, over);
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'failed', reason: 'bad_config', level: 'critical' });
  });
  it('MITAKE_HOST 帶 https:// 前綴也收；帶 port 也收', async () => {
    env.MITAKE_HOST = 'https://api.example.com:443/';
    await make()(signedReq(payload()));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com:443/b2c/mtk/SmSend?CharsetURL=UTF-8');
  });
  it('本機演練例外：http://host.docker.internal:9878 可以', async () => {
    env.MITAKE_HOST = 'http://host.docker.internal:9878';
    await make()(signedReq(payload()));
    expect(fetchMock.mock.calls[0][0]).toBe('http://host.docker.internal:9878/b2c/mtk/SmSend?CharsetURL=UTF-8');
  });
});

describe('供應商分派（SMS_PROVIDER）', () => {
  const urlOf = () => fetchMock.mock.calls[0][0];
  it('沒設 SMS_PROVIDER → 三竹（既有行為不變），log 帶 provider=mitake', async () => {
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(urlOf()).toBe('https://api.example.com/b2c/mtk/SmSend?CharsetURL=UTF-8');
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'mitake', outcome: 'sent' });
  });
  it.each(['mitake', 'MITAKE', ' mitake\n', ''])('SMS_PROVIDER=%j → 三竹', async (v) => {
    env.SMS_PROVIDER = v;
    await make()(signedReq(payload()));
    expect(urlOf()).toContain('/b2c/mtk/SmSend');
  });
  it.each(['maacgo', 'MaacGo', ' maacgo\n'])('SMS_PROVIDER=%j → MAAC Go（只改 env，不動程式）', async (v) => {
    Object.assign(env, { SMS_PROVIDER: v, MAACGO_API_KEY: 'sk_test_k' });
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(urlOf()).toBe('https://sms.cresclab.com/api/sms/send');
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo' });
  });
  it('同一個 handler 實例：env 改了下一次請求就換供應商（不需重建）', async () => {
    const h = make();
    await h(signedReq(payload()));
    Object.assign(env, { SMS_PROVIDER: 'maacgo', MAACGO_API_KEY: 'sk_test_k' });
    await h(signedReq(payload()));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://api.example.com/b2c/mtk/SmSend?CharsetURL=UTF-8', 'https://sms.cresclab.com/api/sms/send']);
  });
  it.each(['twilio', 'maac go', 'maacgo2', 'x'.repeat(200)])('不認得的值 %j → HTTP 500、critical bad_provider、兩家都不呼叫', async (v) => {
    env.SMS_PROVIDER = v;
    const res = await make()(signedReq(payload()));
    expect(res.status).toBe(500);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'failed', reason: 'bad_provider', level: 'critical' });
    expect(logs().join('')).not.toContain('x'.repeat(50)); // 設定值長得怪就不整串寫進 log
  });
  it('簽章驗證在分派之前：簽章錯＋供應商設錯 → 仍是 401（外人探不到設定）', async () => {
    env.SMS_PROVIDER = 'twilio';
    expect((await make()(new Request('https://x/', { method: 'POST', body: payload() }))).status).toBe(401);
  });
  it('maacgo 但缺 MAACGO_API_KEY（三竹三組齊全也不會自動退回三竹）→ 200＋502、bad_config', async () => {
    env.SMS_PROVIDER = 'maacgo';
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'maacgo', reason: 'bad_config', missing: ['MAACGO_API_KEY'] });
  });
  it('mitake 但三竹三組缺（只有 MAACGO_API_KEY）→ 200＋502、bad_config', async () => {
    Object.assign(env, { MITAKE_HOST: undefined, MITAKE_USERNAME: undefined, MITAKE_PASSWORD: undefined, MAACGO_API_KEY: 'sk_test_k' });
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSmsLogs()[0]).toMatchObject({ provider: 'mitake', reason: 'bad_config', missing: ['MITAKE_HOST', 'MITAKE_USERNAME', 'MITAKE_PASSWORD'] });
  });
  it('共用的前置檢查兩家一樣：壞 OTP、非台灣門號都不呼叫任何一家', async () => {
    for (const provider of ['mitake', 'maacgo']) {
      env.SMS_PROVIDER = provider; env.MAACGO_API_KEY = 'sk_test_k';
      await expectFailed(await make()(signedReq(payload({ otp: 'abc' }))));
      await expectFailed(await make()(signedReq(payload({ phone: '+14155550123' }))));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('三竹回覆 → hook 回應', () => {
  const run = async (code: string) => {
    fetchMock.mockResolvedValueOnce(new Response(mitakeText(code), { status: 200 }));
    return make()(signedReq(payload()));
  };
  it.each([
    ['e', 'mitake_account', 'critical'], ['f', 'mitake_account', 'critical'], ['p', 'mitake_access', 'critical'], ['k', 'mitake_access', 'critical'],
    ['s', 'mitake_billing', 'critical'], ['a', 'mitake_down', 'warn'], ['r', 'mitake_down', 'warn'], ['*', 'mitake_down', 'warn'],
    ['l', 'mitake_busy', 'warn'], ['v', 'mitake_bad_number', 'info'], ['6', 'mitake_bad_number', 'info'],
    ['y', 'mitake_request', 'error'], ['u', 'mitake_request', 'error'], ['z', 'mitake_other', 'error'],
  ])('statuscode=%s → 一律同一個 502 失敗 body；log reason=%s level=%s', async (code, reason, level) => {
    await expectFailed(await run(code));
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'failed', reason, level, statuscode: code, phone: '+8869****678', account_point: 126 });
  });
  it('critical／error 走 console.error、warn 走 console.warn、info 走 console.log', async () => {
    await run('e'); await run('l'); await run('v');
    expect(out.map((o) => o.method)).toEqual(['error', 'warn', 'log']);
  });
  it('錯誤 body 不洩漏三竹原文、帳號、點數', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`[${UUID}]\nstatuscode=e\nmsg=帳號密碼錯誤 user1\nAccountPoint=126`, { status: 200 }));
    const t = await (await make()(signedReq(payload()))).text();
    expect(t).toBe(JSON.stringify(FAILED));
  });
  it('格式壞掉（HTML、空白、缺 statuscode）→ 失敗，outcome=unknown（簡訊可能已寄出），不重試', async () => {
    for (const t of ['<html>oops</html>', '', '[1]\nmsgid=x']) {
      fetchMock.mockResolvedValueOnce(new Response(t, { status: 200 }));
      await expectFailed(await make()(signedReq(payload())));
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sendSmsLogs().filter((o) => o.outcome === 'unknown' && o.reason === 'mitake_unparsable')).toHaveLength(3);
  });
  it('三竹 HTTP 非 200（500、502）→ 失敗 reason=mitake_http_<碼>，不重試', async () => {
    for (const st of [500, 502]) {
      fetchMock.mockResolvedValueOnce(new Response('x', { status: st }));
      await expectFailed(await make()(signedReq(payload())));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendSmsLogs().map((o) => o.reason)).toEqual(['mitake_http_500', 'mitake_http_502']);
  });
  it('連線失敗（fetch 丟例外）→ 失敗 mitake_network，不重試，log 只記例外名稱', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED 10.0.0.1:443 user1'));
    await expectFailed(await make()(signedReq(payload())));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs().join('\n')).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'unknown', reason: 'mitake_network', error: 'TypeError' });
  });
  it('Duplicate=Y 照 statuscode 判斷，並記進 log', async () => {
    fetchMock.mockResolvedValueOnce(new Response(mitakeText('1', 'Duplicate=Y\n'), { status: 200 }));
    expect((await make()(signedReq(payload()))).status).toBe(200);
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'sent', duplicate: true });
  });
});

describe('逾時', () => {
  // fake timers 下不能用 vi.waitFor（它會偷偷推進時間）；setImmediate 沒被假造，用它讓出事件迴圈直到 fetch 被呼叫（驗簽的 WebCrypto 是真的非同步）
  const untilFetched = async () => {
    for (let i = 0; i < 200 && fetchMock.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalled();
  };
  // fetch 假件：永遠不回，直到 signal 被 abort 才以 AbortError 拒絕
  const hang = (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
    init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });

  it('預設 3 秒（GoTrue 整個 hook 只有 5 秒）：2.999 秒還沒 abort、3 秒 abort → 失敗；只呼叫一次', async () => {
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
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'unknown', reason: 'mitake_timeout', level: 'error', timeout_ms: 3000 });
  });

  it('MITAKE_TIMEOUT_MS 可覆寫（演練用）；超出範圍或不是數字就用預設 3000', async () => {
    env.MITAKE_TIMEOUT_MS = '100';
    fetchMock.mockImplementation(hang);
    await expectFailed(await make()(signedReq(payload())));
    expect(sendSmsLogs()[0]).toMatchObject({ reason: 'mitake_timeout', timeout_ms: 100 });
    for (const bad of ['abc', '5', '999999', '-1']) {
      out = []; fetchMock.mockClear();
      env.MITAKE_TIMEOUT_MS = bad;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fetchMock.mockImplementation(hang);
      const p = make()(signedReq(payload()));
      await untilFetched();
      await vi.advanceTimersByTimeAsync(3000);
      await p;
      expect(sendSmsLogs()[0]).toMatchObject({ reason: 'mitake_timeout', timeout_ms: 3000 });
      vi.useRealTimers();
    }
  });

  it('回覆讀到一半逾時（標頭到了、body 沒到）也算逾時', async () => {
    env.MITAKE_TIMEOUT_MS = '100';
    fetchMock.mockImplementation(async (_u, init) => {
      const stream = new ReadableStream({
        start(c) { init.signal!.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
      });
      return new Response(stream, { status: 200 });
    });
    await expectFailed(await make()(signedReq(payload())));
    expect(sendSmsLogs()[0]).toMatchObject({ reason: 'mitake_timeout' });
  });
});

describe('log 規則：永不記 OTP、密碼、完整門號、完整 body、secret', () => {
  it('跑過所有路徑後，log 與回應都搜不到敏感字串', async () => {
    const all: string[] = [];
    const h = make();
    const send = async (req: Request) => { const r = await h(req); all.push(await r.clone().text()); };
    await send(signedReq(payload()));                                                         // 成功
    for (const c of ['v', 'e', 's', 'x']) { fetchMock.mockResolvedValueOnce(new Response(mitakeText(c))); await send(signedReq(payload())); }
    fetchMock.mockResolvedValueOnce(new Response('garbage')); await send(signedReq(payload()));
    fetchMock.mockRejectedValueOnce(new TypeError('boom ' + PASSWORD)); await send(signedReq(payload()));
    await send(signedReq(payload({ phone: '+14155550123', userPhone: '+14155550123' })));      // 非台灣
    await send(signedReq(payload({ otp: 'abc' })));                                           // 壞 payload
    await send(signedReq('not json'));
    await send(signedReq(payload(), { key: Buffer.from('another-key-another-key-another-k') })); // 簽章錯
    env.MITAKE_PASSWORD = ''; await send(signedReq(payload()));                                // 設定錯
    const text = logs().join('\n') + '\n' + all.join('\n');
    for (const s of [OTP, PASSWORD, '912345678', '886912345678', '0912345678', '4155550123', '你的驗證碼', '請勿提供給任何人', 'whsec_', KEY.toString('base64'), 'user1']) {
      expect(text, `不該出現：${s}`).not.toContain(s);
    }
    expect(logs().length).toBeGreaterThan(10);
    for (const l of logs()) { expect(l).not.toContain('\n'); expect(() => JSON.parse(l)).not.toThrow(); }
  });
});

describe('未預期的例外', () => {
  it('handler 內部丟例外 → 失敗 body，log 只記例外名稱', async () => {
    const h = createHandler({ env: () => { throw new RangeError('secret detail ' + PASSWORD); }, fetch: fetchMock as unknown as Deps['fetch'], now: () => NOW_MS, uuid: () => UUID });
    await expectFailed(await h(signedReq(payload())));
    expect(logs().join('')).not.toContain(PASSWORD);
    expect(sendSmsLogs()[0]).toMatchObject({ outcome: 'failed', reason: 'unexpected', level: 'critical', error: 'RangeError' });
  });
});
