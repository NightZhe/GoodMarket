import { describe, expect, it } from 'vitest';
import { createHandler, describeError, safeEqual, type Deps, type ReportStore } from './handler.ts';
import type { ReportRow } from './mail.ts';
import { SmtpError, type SmtpConfig } from './smtp.ts';

const SECRET = 'shared-secret-0123456789abcdef';
const RID = '33333333-3333-4333-8333-333333333333';
const PID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const row = (o: Partial<ReportRow> = {}): ReportRow => ({
  id: RID, target_type: 'product', target_id: PID, target_label: '手工皂', target_shop_id: SID, reason: 'scam', details: '不實',
  created_at: '2026-10-25T12:05:03+00:00', notified_at: null, notify_attempts: 0, ...o,
});
const ENV: Record<string, string> = {
  REPORT_NOTIFY_SECRET: SECRET, REPORT_NOTIFY_TO: 'site@example.com', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465',
  SMTP_USER: 'bot@example.com', SMTP_PASS: 'app-password-xyz', SMTP_FROM: 'bot@example.com',
};

function setup(o: { rows?: ReportRow[]; env?: Record<string, string | undefined>; send?: Deps['send']; store?: Partial<ReportStore> } = {}) {
  const rows = new Map((o.rows ?? [row()]).map((r) => [r.id, r]));
  const calls = { sent: [] as Array<{ cfg: SmtpConfig; raw: string }>, markSent: [] as string[], markFailed: [] as Array<{ id: string; error: string }>, logs: [] as string[] };
  const store: ReportStore = {
    get: async (id) => rows.get(id) ?? null,
    reviewProductId: async () => PID,
    markSent: async (r) => { calls.markSent.push(r.id); },
    markFailed: async (r, error) => { calls.markFailed.push({ id: r.id, error }); },
    ...o.store,
  };
  const env = { ...ENV, ...(o.env ?? {}) };
  const handle = createHandler({
    env: (k) => env[k], store, now: () => Date.parse('2026-10-25T12:06:00Z'), uuid: () => 'msg-id-1',
    send: o.send ?? (async (cfg, raw) => { calls.sent.push({ cfg, raw }); }),
    log: (_l, line) => calls.logs.push(line),
  });
  const call = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${SECRET}` }, method = 'POST') =>
    handle(new Request('https://x.test/functions/v1/report-notify', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }));
  return { call, calls, rows };
}

describe('AC-K11 / R-K10：身分驗證', () => {
  it('沒帶 Authorization → 401，不讀資料庫、不寄信', async () => {
    let read = 0;
    const s = setup({ store: { get: async () => { read++; return row(); } } });
    const r = await s.call({ id: RID }, {});
    expect(r.status).toBe(401);
    expect(read).toBe(0);
    expect(s.calls.sent).toHaveLength(0);
  });
  it.each([
    ['密鑰錯', 'Bearer wrong'],
    ['缺 Bearer 前綴', SECRET],
    ['Basic', `Basic ${SECRET}`],
    ['密鑰後面多一個字', `Bearer ${SECRET}x`],
    ['小寫密鑰', `Bearer ${SECRET.toUpperCase()}`],
    ['空密鑰', 'Bearer '],
  ])('%s → 401', async (_n, auth) => {
    const s = setup();
    expect((await s.call({ id: RID }, { Authorization: auth })).status).toBe(401);
    expect(s.calls.sent).toHaveLength(0);
    expect(s.calls.markSent).toHaveLength(0);
  });
  it('伺服器沒設 REPORT_NOTIFY_SECRET → 一律 401（不退化成不驗證），即使呼叫端也沒帶', async () => {
    const s = setup({ env: { REPORT_NOTIFY_SECRET: undefined } });
    expect((await s.call({ id: RID }, {})).status).toBe(401);
    expect((await s.call({ id: RID }, { Authorization: 'Bearer ' })).status).toBe(401);
    expect((await s.call({ id: RID }, { Authorization: 'Bearer undefined' })).status).toBe(401);
    expect(s.calls.sent).toHaveLength(0);
  });
  it('401 回應與 log 都不含密鑰', async () => {
    const s = setup();
    const r = await s.call({ id: RID }, { Authorization: 'Bearer wrong-guess' });
    expect(await r.text()).not.toContain(SECRET);
    expect(s.calls.logs.join('')).not.toContain(SECRET);
    expect(s.calls.logs.join('')).not.toContain('wrong-guess');
  });
  it('非 POST → 405', async () => {
    expect((await setup().call(null, { Authorization: `Bearer ${SECRET}` }, 'GET')).status).toBe(405);
  });
  it('safeEqual', async () => {
    expect(await safeEqual('abc', 'abc')).toBe(true);
    expect(await safeEqual('abc', 'abd')).toBe(false);
    expect(await safeEqual('abc', 'abcd')).toBe(false);
    expect(await safeEqual('', '')).toBe(true);
  });
});

describe('AC-K11：只寄存在且未通知的檢舉', () => {
  it.each([[''], ['{}'], ['null'], ['[]'], ['not json'], ['{"id":123}'], ['{"id":"not-a-uuid"}'], ['{"id":"1; drop table reports"}']])('壞 body %j → 400、不寄', async (b) => {
    const s = setup();
    expect((await s.call(b)).status).toBe(400);
    expect(s.calls.sent).toHaveLength(0);
  });
  it('body 過大 → 413', async () => {
    expect((await setup().call(JSON.stringify({ id: RID, pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  it('id 不存在 → 404、不寄、不寫入', async () => {
    const s = setup();
    const r = await s.call({ id: '99999999-9999-4999-8999-999999999999' });
    expect(r.status).toBe(404);
    expect(s.calls.sent).toHaveLength(0);
    expect(s.calls.markFailed).toHaveLength(0);
  });
  it('已通知 → 200 already_notified、不寄、不寫入', async () => {
    const s = setup({ rows: [row({ notified_at: '2026-10-25T12:06:00Z', notify_attempts: 1 })] });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, status: 'already_notified' });
    expect(s.calls.sent).toHaveLength(0);
    expect(s.calls.markSent).toHaveLength(0);
  });
  it('收件人固定來自 secret：body 裡的 to／email 被忽略', async () => {
    const s = setup();
    await s.call({ id: RID, to: 'evil@x.com', email: 'evil@x.com', recipients: ['evil@x.com'] });
    expect(s.calls.sent).toHaveLength(1);
    expect(s.calls.sent[0].cfg.to).toEqual(['site@example.com']);
    expect(s.calls.sent[0].raw).not.toContain('evil@x.com');
  });
});

describe('寄信成功', () => {
  it('寄一封、記成功（markSent 一次）、回 200 sent', async () => {
    const s = setup();
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, status: 'sent' });
    expect(s.calls.sent).toHaveLength(1);
    expect(s.calls.markSent).toEqual([RID]);
    expect(s.calls.markFailed).toHaveLength(0);
    const { cfg, raw } = s.calls.sent[0];
    expect(cfg).toMatchObject({ host: 'smtp.example.com', port: 465, user: 'bot@example.com', pass: 'app-password-xyz', from: 'bot@example.com', to: ['site@example.com'] });
    expect(raw).toContain('To: site@example.com');
    expect(raw).toContain('Message-ID: <msg-id-1@example.com>');
    expect(raw).toContain('Date: Sun, 25 Oct 2026 12:06:00 +0000');
  });
  it('信件內容符合 R-K8 且不含檢舉人資料', async () => {
    const s = setup({ rows: [{ ...row(), reporter_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as ReportRow] });
    await s.call({ id: RID });
    const raw = s.calls.sent[0].raw;
    const body = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    const head = raw.split('\r\n\r\n')[0].replace(/\r\n /g, ' ');
    const subject = head.split('\r\n').find((l) => l.startsWith('Subject:'))!;
    const words = [...subject.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)].map((w) => Buffer.from(w[1], 'base64').toString('utf8'));
    expect(words.join('')).toBe('[好物集] 新檢舉：商品 詐騙或不實資訊');
    expect(body).toContain(`檢舉編號：${RID}`);
    expect(body).toContain(`https://nightzhe.github.io/GoodMarket/#/product/${PID}`);
    expect(raw + body).not.toContain('aaaaaaaa-aaaa');
    expect(raw).not.toContain('app-password-xyz');
  });
  it('評價 → 查所屬商品，連到評價總覽；查詢失敗 → 退回店家連結且照寄', async () => {
    const REV = row({ target_type: 'review', target_id: '44444444-4444-4444-8444-444444444444' });
    const a = setup({ rows: [REV] });
    await a.call({ id: RID });
    const bodyOf = (raw: string) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(bodyOf(a.calls.sent[0].raw)).toContain(`#/product/${PID}/reviews`);
    const b = setup({ rows: [REV], store: { reviewProductId: async () => { throw new Error('db down'); } } });
    await b.call({ id: RID });
    expect(b.calls.sent).toHaveLength(1);
    expect(bodyOf(b.calls.sent[0].raw)).toContain(`#/shop/${SID}`);
  });
  it('寄出後記錄失敗 → 仍回 200（不丟 5xx），log 有記', async () => {
    const s = setup({ store: { markSent: async () => { throw new Error('PostgREST 500'); } } });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, status: 'sent', recorded: false });
    expect(s.calls.logs.join('\n')).toContain('sent_but_not_recorded');
  });
  it('本機模式：不設 SMTP_USER／SMTP_PASS 也能寄', async () => {
    const s = setup({ env: { SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_PORT: '1025', SMTP_FROM: '好物集 <noreply@example.com>' } });
    await s.call({ id: RID });
    expect(s.calls.sent[0].cfg).toMatchObject({ port: 1025, user: undefined, pass: undefined, from: 'noreply@example.com' });
  });
});

describe('AC-K9：失敗不丟 5xx，並記在檢舉列', () => {
  it('SMTP 帳密錯（535）→ 200＋error、markFailed 一次、錯誤摘要有碼無密碼', async () => {
    const s = setup({ send: async () => { throw new SmtpError('auth', 'SMTP 535 at auth: 5.7.8 Username and Password not accepted app-password-xyz', 535); } });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, error: 'send_failed' });
    expect(s.calls.markSent).toHaveLength(0);
    expect(s.calls.markFailed).toHaveLength(1);
    const msg = s.calls.markFailed[0].error;
    expect(msg).toContain('535');
    expect(msg).not.toContain('app-password-xyz');
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(s.calls.logs.join('')).not.toContain('app-password-xyz');
  });
  it('連不上（例如 25／587／465 被擋）→ 200＋error、摘要記錄', async () => {
    const s = setup({ send: async () => { throw new Error('connection refused (os error 111)'); } });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(s.calls.markFailed[0].error).toContain('connection refused');
  });
  it('摘要超長會截斷到 500、換行被壓平', async () => {
    const s = setup({ send: async () => { throw new Error('x\r\ny'.repeat(400)); } });
    await s.call({ id: RID });
    const msg = s.calls.markFailed[0].error;
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(msg).not.toMatch(/[\r\n]/);
  });
  it('設定缺漏 → 不寄、markFailed 記缺哪個（只記名稱不記值）', async () => {
    const s = setup({ env: { SMTP_HOST: undefined, REPORT_NOTIFY_TO: 'not-an-email' } });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, error: 'not_configured' });
    expect(s.calls.sent).toHaveLength(0);
    expect(s.calls.markFailed[0].error).toBe('not_configured: SMTP_HOST, REPORT_NOTIFY_TO');
  });
  it('只設 SMTP_USER 沒設 SMTP_PASS → not_configured', async () => {
    const s = setup({ env: { SMTP_PASS: undefined } });
    await s.call({ id: RID });
    expect(s.calls.markFailed[0].error).toContain('SMTP_USER/SMTP_PASS');
    expect(s.calls.sent).toHaveLength(0);
  });
  it('SMTP_PORT 非數字／超出範圍 → not_configured', async () => {
    for (const p of ['abc', '0', '70000', '465; x']) {
      const s = setup({ env: { SMTP_PORT: p } });
      await s.call({ id: RID });
      expect(s.calls.markFailed[0].error, p).toContain('SMTP_PORT');
    }
  });
  it('資料庫讀取失敗 → 200＋internal（不丟 5xx）', async () => {
    const s = setup({ store: { get: async () => { throw new Error('PostgREST 503'); } } });
    const r = await s.call({ id: RID });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, error: 'internal' });
  });
  it('markFailed 本身失敗 → 仍回 200', async () => {
    const s = setup({ send: async () => { throw new Error('boom'); }, store: { markFailed: async () => { throw new Error('db'); } } });
    expect((await s.call({ id: RID })).status).toBe(200);
  });
});

describe('describeError', () => {
  it('遮掉密碼與帳號、截斷、去控制字元', () => {
    const m = describeError(new Error('bad login bot@example.com / hunter2\nnext'), ['hunter2', 'bot@example.com']);
    expect(m).not.toContain('hunter2');
    expect(m).not.toContain('bot@example.com');
    expect(m).not.toMatch(/\n/);
    expect(describeError('str', [])).toBe('unknown error');
    expect(describeError(new Error('a'.repeat(900)), []).length).toBe(500);
  });
});
