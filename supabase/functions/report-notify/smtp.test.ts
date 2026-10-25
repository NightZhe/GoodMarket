import { describe, expect, it } from 'vitest';
import { sendViaSmtp, SmtpError, type Conn, type SmtpConfig, type SmtpTransport } from './smtp.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 假伺服器：依「收到什麼指令 → 回什麼」的劇本回應，並記錄用戶端送出的所有行。 */
type Script = (line: string, state: { inData: boolean }) => string | null;
function fakeServer(opts: { greeting?: string; script: Script; hangOnConnect?: boolean }) {
  const log: string[] = [];
  const connects: Array<{ host: string; port: number; tls: boolean }> = [];
  const upgrades: string[] = [];
  const mkConn = (greet = true): Conn => {
    const queue: Uint8Array[] = greet ? [enc.encode(opts.greeting ?? '220 fake ESMTP\r\n')] : [];
    let waiter: ((v: Uint8Array | null) => void) | null = null;
    let closed = false;
    let buf = '';
    const state = { inData: false };
    const push = (s: string) => { const b = enc.encode(s); if (waiter) { const w = waiter; waiter = null; w(b); } else queue.push(b); };
    return {
      read() {
        if (queue.length) return Promise.resolve(queue.shift()!);
        if (closed) return Promise.resolve(null);
        return new Promise((r) => { waiter = r; });
      },
      async write(data) {
        buf += dec.decode(data);
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          log.push(line);
          const out = opts.script(line, state);
          if (out) push(out);
        }
      },
      close() { closed = true; if (waiter) { const w = waiter; waiter = null; w(null); } },
    };
  };
  const transport: SmtpTransport = {
    async connect(host, port, tls) {
      connects.push({ host, port, tls });
      if (opts.hangOnConnect) return new Promise<Conn>(() => {});
      return mkConn();
    },
    async startTls(_conn, host) { upgrades.push(host); return mkConn(false); },
  };
  return { transport, log, connects, upgrades };
}

/** 一般劇本：EHLO 宣告 caps；AUTH PLAIN 驗帳密；DATA 收到 "." 結束。 */
function standard(caps: string[], auth?: { user: string; pass: string }): Script {
  return (line, st) => {
    if (st.inData) { if (line === '.') { st.inData = false; return '250 2.0.0 queued as XYZ\r\n'; } return null; }
    if (line.startsWith('EHLO ')) return ['250-fake', ...caps.slice(0, -1).map((c) => `250-${c}`), `250 ${caps[caps.length - 1] ?? 'OK'}`].join('\r\n') + '\r\n';
    if (line === 'STARTTLS') return '220 ready\r\n';
    if (line.startsWith('AUTH PLAIN ')) {
      const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\0');
      return auth && u === auth.user && p === auth.pass ? '235 2.7.0 ok\r\n' : '535-5.7.8 Username and Password not accepted\r\n535 5.7.8 see docs\r\n';
    }
    if (line.startsWith('MAIL FROM:')) return '250 ok\r\n';
    if (line.startsWith('RCPT TO:')) return '250 ok\r\n';
    if (line === 'DATA') { st.inData = true; return '354 go\r\n'; }
    if (line === 'QUIT') return '221 bye\r\n';
    return '500 what\r\n';
  };
}

const cfg = (o: Partial<SmtpConfig> = {}): SmtpConfig => ({ host: 'smtp.test', port: 1025, from: 'from@x.co', to: ['to@x.co'], timeoutMs: 500, ...o });
const MSG = 'Subject: hi\r\n\r\nbody\r\n';

describe('sendViaSmtp', () => {
  it('無 TLS、無 AUTH（本機 Mailpit 模式）：完整指令順序', async () => {
    const s = fakeServer({ script: standard(['8BITMIME', 'SIZE 1000']) });
    await sendViaSmtp(s.transport, cfg(), MSG);
    expect(s.connects).toEqual([{ host: 'smtp.test', port: 1025, tls: false }]);
    expect(s.log).toEqual(['EHLO localhost', 'MAIL FROM:<from@x.co>', 'RCPT TO:<to@x.co>', 'DATA', 'Subject: hi', '', 'body', '.', 'QUIT']);
  });

  it('465＝隱含 TLS；AUTH PLAIN 帳密正確', async () => {
    const s = fakeServer({ script: standard(['AUTH PLAIN LOGIN XOAUTH2'], { user: 'u@x.co', pass: 'pw' }) });
    await sendViaSmtp(s.transport, cfg({ port: 465, user: 'u@x.co', pass: 'pw' }), MSG);
    expect(s.connects[0]).toMatchObject({ port: 465, tls: true });
    expect(s.log.some((l) => l.startsWith('AUTH PLAIN '))).toBe(true);
    expect(s.log).toContain('DATA');
  });

  it('帳密錯 → SmtpError(auth, 535)，訊息有回應碼但不含密碼；不會往下送 MAIL FROM', async () => {
    const s = fakeServer({ script: standard(['AUTH PLAIN'], { user: 'u@x.co', pass: 'right' }) });
    const e = await sendViaSmtp(s.transport, cfg({ port: 465, user: 'u@x.co', pass: 'wrong-secret' }), MSG).catch((x) => x);
    expect(e).toBeInstanceOf(SmtpError);
    expect(e.stage).toBe('auth');
    expect(e.code).toBe(535);
    expect(e.message).toContain('535');
    expect(e.message).not.toContain('wrong-secret');
    expect(s.log.some((l) => l.startsWith('MAIL FROM'))).toBe(false);
  });

  it('只支援 AUTH LOGIN 的伺服器', async () => {
    const steps: string[] = [];
    const s = fakeServer({
      script: (line, st) => {
        if (line.startsWith('EHLO ')) return '250-x\r\n250 AUTH LOGIN\r\n';
        if (line === 'AUTH LOGIN') return '334 VXNlcm5hbWU6\r\n';
        if (!st.inData && steps.length === 0 && Buffer.from(line, 'base64').toString() === 'u') { steps.push('user'); return '334 UGFzc3dvcmQ6\r\n'; }
        if (steps.length === 1 && Buffer.from(line, 'base64').toString() === 'p') { steps.push('pass'); return '235 ok\r\n'; }
        return standard([])(line, st);
      },
    });
    await sendViaSmtp(s.transport, cfg({ port: 465, user: 'u', pass: 'p' }), MSG);
    expect(steps).toEqual(['user', 'pass']);
  });

  it('伺服器沒有 AUTH PLAIN／LOGIN → 報錯', async () => {
    const s = fakeServer({ script: standard(['AUTH XOAUTH2']) });
    await expect(sendViaSmtp(s.transport, cfg({ port: 465, user: 'u', pass: 'p' }), MSG)).rejects.toMatchObject({ stage: 'auth' });
  });

  it('有帳密但沒有 TLS → 拒絕登入（不在明碼連線上送密碼）', async () => {
    const s = fakeServer({ script: standard(['AUTH PLAIN']) });
    await expect(sendViaSmtp(s.transport, cfg({ port: 1025, user: 'u', pass: 'p' }), MSG)).rejects.toMatchObject({ stage: 'auth' });
    expect(s.log.some((l) => l.startsWith('AUTH'))).toBe(false);
  });

  it('只設了帳號沒設密碼 → 拒絕', async () => {
    const s = fakeServer({ script: standard(['STARTTLS']) });
    await expect(sendViaSmtp(s.transport, cfg({ user: 'u' }), MSG)).rejects.toMatchObject({ stage: 'auth' });
  });

  it('STARTTLS：伺服器有宣告 → 升級後重新 EHLO，再 AUTH', async () => {
    const s = fakeServer({ script: standard(['STARTTLS', 'AUTH PLAIN'], { user: 'u', pass: 'p' }) });
    await sendViaSmtp(s.transport, cfg({ port: 587, user: 'u', pass: 'p' }), MSG);
    expect(s.upgrades).toEqual(['smtp.test']);
    expect(s.log.indexOf('STARTTLS')).toBeGreaterThan(-1);
  });

  it('多個收件人；RCPT 被拒 → SmtpError(rcpt_to, 550)', async () => {
    const s = fakeServer({ script: (l, st) => (l === 'RCPT TO:<bad@x.co>' ? '550 no such user\r\n' : standard([])(l, st)) });
    const e = await sendViaSmtp(s.transport, cfg({ to: ['a@x.co', 'bad@x.co'] }), MSG).catch((x) => x);
    expect(e).toMatchObject({ stage: 'rcpt_to', code: 550 });
    expect(s.log.filter((l) => l.startsWith('RCPT'))).toHaveLength(2);
    expect(s.log).not.toContain('DATA');
  });

  it('dot-stuffing：行首的 . 加倍，內文的單獨一個 . 不會提早結束', async () => {
    const s = fakeServer({ script: standard([]) });
    await sendViaSmtp(s.transport, cfg(), 'Subject: x\r\n\r\nline\r\n.\r\n..two\r\nend\r\n');
    const i = s.log.indexOf('DATA');
    expect(s.log.slice(i + 1, -1)).toEqual(['Subject: x', '', 'line', '..', '...two', 'end', '.']);
  });

  it('多行回應（250-…）與只有 LF 的伺服器', async () => {
    const s = fakeServer({ greeting: '220-hello\n220 there\n', script: (l, st) => standard(['PIPELINING'])(l, st) });
    await sendViaSmtp(s.transport, cfg(), MSG);
  });

  it('招呼就被拒（554）、DATA 結束被拒（452）、連線中斷', async () => {
    const a = fakeServer({ greeting: '554 no service\r\n', script: standard([]) });
    await expect(sendViaSmtp(a.transport, cfg(), MSG)).rejects.toMatchObject({ stage: 'greeting', code: 554 });
    const b = fakeServer({ script: (l, st) => (st.inData && l === '.' ? ((st.inData = false), '452 insufficient storage\r\n') : standard([])(l, st)) });
    await expect(sendViaSmtp(b.transport, cfg(), MSG)).rejects.toMatchObject({ stage: 'data_end', code: 452 });
    const c = fakeServer({ script: (l) => (l.startsWith('EHLO') ? null : null) });
    // 伺服器只回招呼、之後關線
    const closing: SmtpTransport = { connect: async () => { const k = (await c.transport.connect('h', 1, false)); setTimeout(() => k.close(), 20); return k; }, startTls: c.transport.startTls };
    await expect(sendViaSmtp(closing, cfg(), MSG)).rejects.toMatchObject({ stage: 'read' });
  });

  it('連線卡住 → 逾時（SmtpError timeout），不會無限等', async () => {
    const s = fakeServer({ script: standard([]), hangOnConnect: true });
    const t0 = Date.now();
    await expect(sendViaSmtp(s.transport, cfg({ timeoutMs: 80 }), MSG)).rejects.toMatchObject({ stage: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('伺服器不回話 → 逾時並關閉連線', async () => {
    const s = fakeServer({ script: () => null });
    await expect(sendViaSmtp(s.transport, cfg({ timeoutMs: 80 }), MSG)).rejects.toMatchObject({ stage: 'timeout' });
  });
});
