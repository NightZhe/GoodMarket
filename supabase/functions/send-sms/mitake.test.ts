import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildSmSendRequest, classifyStatus, maskPhone, parseMitakeReply, renderSmsBody, resolveMitakeBase,
  SMS_TEMPLATE, toMitakeNumber,
} from './mitake.ts';

describe('門號：台灣手機 → 三竹格式', () => {
  it.each(['+886912345678', '886912345678'])('%s → 0912345678（GoTrue 實測不帶 +，文件範例帶 +，兩種都收）', (p) => {
    expect(toMitakeNumber(p)).toBe('0912345678');
  });
  it.each([
    '+88612345678',     // 市話區碼
    '+886812345678',    // 非 9 開頭
    '+8869123456789',   // 多一碼
    '+88691234567',     // 少一碼
    '0912345678',       // 本地格式
    '88609123456789',
    '+886 912345678',   // 空白
    '++886912345678',
    '+886912345abc',
    '+14155550123',     // 其他國家
    '+85291234567',     // 香港
    '',
  ])('拒絕 %j', (p) => {
    expect(toMitakeNumber(p)).toBeNull();
  });
});

describe('門號遮罩（log 用）', () => {
  it.each(['+886912345678', '886912345678'])('%s → +8869****678', (p) => {
    expect(maskPhone(p)).toBe('+8869****678');
  });
  it('格式不對的字串也不會整串寫進 log', () => {
    const m = maskPhone('+14155550123456');
    expect(m).not.toContain('5550123');
    expect(m).toContain('****');
    expect(maskPhone('abc')).toBe('****');
    expect(maskPhone(undefined)).toBe('****');
    expect(maskPhone(912345678)).toBe('****');
  });
});

describe('簡訊內文', () => {
  it('把 {{ .Code }} 換成 OTP', () => {
    expect(renderSmsBody('123456')).toBe('【好物集】你的驗證碼是 123456，5 分鐘內有效。請勿提供給任何人。');
  });
  it('與 .work 的範本檔 templates/sms.txt 逐字一致（範本檔不進版控；找不到時不在這台機器上跑，會明確標示）', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // worktree 與主工作樹都找：往上找 .work/，再找 git 共用目錄旁的主工作樹
    const cands = [
      resolve(here, '../../../.work/phone-otp-auth/templates/sms.txt'),
      resolve(here, '../../../../../../.work/phone-otp-auth/templates/sms.txt'),
    ];
    const f = cands.find(existsSync);
    if (!f) { console.warn('找不到 templates/sms.txt，略過範本比對'); return; }
    expect(SMS_TEMPLATE).toBe(readFileSync(f, 'utf8').trim());
  });
  it('整則在 70 字以內（中文短簡訊上限，OTP 以 6 字計）', () => {
    expect([...renderSmsBody('123456')].length).toBeLessThanOrEqual(70);
  });
});

describe('MITAKE_HOST → 基底網址', () => {
  it.each([
    ['api.example.com', 'https://api.example.com'],
    ['  api.example.com  ', 'https://api.example.com'],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['api.example.com:443', 'https://api.example.com:443'],
    ['host.docker.internal:9443', 'https://host.docker.internal:9443'],   // 沒寫 scheme 一律 https，連本機主機也是
    ['http://host.docker.internal:9878', 'http://host.docker.internal:9878'], // 本機演練的唯一例外
    ['http://localhost:9878', 'http://localhost:9878'],
    ['http://127.0.0.1:9878', 'http://127.0.0.1:9878'],
  ])('%j → %j', (raw, base) => {
    expect(resolveMitakeBase(raw)).toBe(base);
  });
  it.each([
    'http://api.example.com', 'http://api.example.com:9878', 'http://localhost.evil.com', 'ftp://x', 'api.example.com/b2c', 'a b', '',
    undefined, 'user:pw@api.example.com', 'api.example.com?x=1', 'http://',
  ])('拒絕 %j', (raw) => {
    expect(resolveMitakeBase(raw)).toBeNull();
  });
});

describe('SmSend 請求組裝', () => {
  const req = buildSmSendRequest(
    { base: 'https://api.example.com', username: 'u1', password: 'p&w=d+x' },
    { dstaddr: '0912345678', smbody: '【好物集】你的驗證碼是 123456，5 分鐘內有效。', clientid: '11111111-2222-4333-8444-555555555555' },
  );
  const params = new URLSearchParams(req.init.body as string);
  it('URL 是 {base}/b2c/mtk/SmSend?CharsetURL=UTF-8，POST 表單；網址裡沒有帳密', () => {
    expect(req.url).toBe('https://api.example.com/b2c/mtk/SmSend?CharsetURL=UTF-8');
    expect(req.url).not.toMatch(/username|password|u1|p%26w/);
    expect(req.init.method).toBe('POST');
    expect((req.init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
  it('body 參數：username、password、dstaddr、smbody、clientid、vldtime=300、smsPointFlag=1（特殊字元 round-trip）', () => {
    expect(Object.fromEntries(params)).toEqual({
      username: 'u1', password: 'p&w=d+x', dstaddr: '0912345678',
      smbody: '【好物集】你的驗證碼是 123456，5 分鐘內有效。',
      clientid: '11111111-2222-4333-8444-555555555555', vldtime: '300', smsPointFlag: '1',
    });
  });
  it('空白編成 %20、不是 +（避免對方的解碼器不把 + 當空白）', () => {
    expect(req.init.body as string).not.toContain('+'); // 密碼裡的 + 會是 %2B，所以不應有任何字面 +
    expect(req.init.body as string).toContain('%20');
  });
});

describe('回覆解析', () => {
  it('成功回覆（文件範例）', () => {
    const r = parseMitakeReply('[1]\nmsgid=#000000013\nstatuscode=1\nAccountPoint=126\nsmsPoint=1\n');
    expect(r).toEqual({ statuscode: '1', msgid: '#000000013', accountPoint: 126, smsPoint: 1, duplicate: false });
  });
  it('CRLF、Duplicate=Y、clientid 當標頭', () => {
    const r = parseMitakeReply('[11111111-2222-4333-8444-555555555555]\r\nmsgid=#000000013\r\nstatuscode=0\r\nAccountPoint=5\r\nDuplicate=Y\r\n');
    expect(r).toMatchObject({ statuscode: '0', duplicate: true, accountPoint: 5 });
  });
  it('失敗回覆沒有 msgid', () => {
    expect(parseMitakeReply('[1]\nstatuscode=e\n')).toEqual({ statuscode: 'e', msgid: undefined, accountPoint: undefined, smsPoint: undefined, duplicate: false });
  });
  it.each([
    '', '<html>502 Bad Gateway</html>', 'statuscode=1', '[1]\nmsgid=x', '[1]\nstatuscode=', '[1]\nstatuscode=ab', '[1]\nstatuscode=1\nstatuscode=e',
  ])('格式壞掉回 null：%j', (t) => {
    expect(parseMitakeReply(t)).toBeNull();
  });
  it('AccountPoint 不是數字時不採用（不拿來寫 log）', () => {
    expect(parseMitakeReply('[1]\nstatuscode=1\nAccountPoint=abc')?.accountPoint).toBeUndefined();
  });
});

describe('statuscode 分類（spec-mitake.md R-M6）', () => {
  it.each(['0', '1', '2', '4'])('%s 成功（2、4 是已送達業者／手機，比 1 更進一步）', (c) => expect(classifyStatus(c)).toEqual({ ok: true }));
  it.each([
    [['e', 'f', 'h', 'm', 'n'], 'mitake_account', 'critical'],
    [['k', 'p'], 'mitake_access', 'critical'],
    [['s'], 'mitake_billing', 'critical'],
    [['a', 'b', 'r', '*'], 'mitake_down', 'warn'],
    [['l'], 'mitake_busy', 'warn'],
    [['v', '6'], 'mitake_bad_number', 'info'],
    [['c', 'd', 'u', 'y', '5', 'x'], 'mitake_request', 'error'],
    [['7', '8', '9', 't', 'w', 'z', '3', '?'], 'mitake_other', 'error'],
  ] as const)('%j → %s／%s', (codes, reason, severity) => {
    for (const c of codes) expect(classifyStatus(c), c).toEqual({ ok: false, reason, severity });
  });
  it.each(['', 'ab', 'cd', '01', '14'])('%j（空字串或多字元）不能被當成單一碼，更不能當成功', (c) => {
    expect(classifyStatus(c)).toEqual({ ok: false, reason: 'mitake_other', severity: 'error' });
  });
});
