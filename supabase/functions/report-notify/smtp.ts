// 最小 SMTP 用戶端（純協定邏輯；實際的 TCP／TLS 由注入的 SmtpTransport 提供，所以可在 Node 下用假伺服器測試）。
// 支援：隱含 TLS（465）、STARTTLS（伺服器有宣告時）、無 TLS（本機測試用 Mailpit）；AUTH PLAIN／LOGIN。
// 安全規則：有設帳號密碼時，沒有 TLS 就拒絕登入（不在明碼連線上送密碼）。
// 注意：Supabase Edge Function 禁止連出 25、587 埠 → 正式站只有 465（隱含 TLS）走得通；STARTTLS 路徑只給本機／其他環境。
// 錯誤訊息只含階段、回應碼與伺服器回應文字（截斷），不含指令內容，所以不會帶出帳密。

export interface Conn {
  /** 回 null＝對方關閉連線 */
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  close(): void;
}
export interface SmtpTransport {
  connect(host: string, port: number, tls: boolean): Promise<Conn>;
  /** 把既有連線升級成 TLS（STARTTLS 之後）。 */
  startTls(conn: Conn, host: string): Promise<Conn>;
}
export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** 信封寄件人（純位址） */
  from: string;
  /** 信封收件人（純位址） */
  to: string[];
  helo?: string;
  timeoutMs?: number;
}

export class SmtpError extends Error {
  constructor(readonly stage: string, message: string, readonly code?: number) { super(message); this.name = 'SmtpError'; }
}

const enc = new TextEncoder();
const MAX_BUF = 64 * 1024;
export const DEFAULT_SMTP_TIMEOUT_MS = 20_000;

interface Reply { code: number; lines: string[] }

class Reader {
  private buf = '';
  private decoder = new TextDecoder();
  constructor(private conn: Conn) {}
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\n');
      if (i >= 0) {
        const l = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        return l;
      }
      if (this.buf.length > MAX_BUF) throw new SmtpError('read', 'SMTP reply too long');
      const chunk = await this.conn.read();
      if (chunk === null) throw new SmtpError('read', 'SMTP connection closed by server');
      this.buf += this.decoder.decode(chunk, { stream: true });
    }
  }
  async reply(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const l = await this.line();
      const m = /^(\d{3})([ -])?(.*)$/.exec(l);
      if (!m) throw new SmtpError('read', 'SMTP malformed reply');
      lines.push(m[3] ?? '');
      if (m[2] !== '-') return { code: Number(m[1]), lines };
    }
  }
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max);

export async function sendViaSmtp(t: SmtpTransport, cfg: SmtpConfig, message: string): Promise<void> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
  let conn: Conn | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = (async () => {
    const implicitTls = cfg.port === 465;
    conn = await t.connect(cfg.host, cfg.port, implicitTls);
    let reader = new Reader(conn);
    let tlsActive = implicitTls;

    const cmd = async (line: string) => { await conn!.write(enc.encode(line + '\r\n')); };
    const expect = async (stage: string, ok: number[]): Promise<Reply> => {
      const r = await reader.reply();
      if (!ok.includes(r.code)) throw new SmtpError(stage, `SMTP ${r.code} at ${stage}: ${clean(r.lines.join(' '), 200)}`, r.code);
      return r;
    };
    const ehlo = async () => {
      await cmd(`EHLO ${cfg.helo ?? 'localhost'}`);
      const r = await expect('ehlo', [250]);
      const caps = r.lines.map((l) => l.toUpperCase());
      const auth = caps.filter((l) => /^AUTH[ =]/.test(l)).flatMap((l) => l.slice(5).split(/[ =]+/)).filter(Boolean);
      return { starttls: caps.includes('STARTTLS'), auth };
    };

    await expect('greeting', [220]);
    let caps = await ehlo();
    if (!tlsActive && caps.starttls) {
      await cmd('STARTTLS');
      await expect('starttls', [220]);
      conn = await t.startTls(conn, cfg.host);
      reader = new Reader(conn);
      tlsActive = true;
      caps = await ehlo();
    }

    if (cfg.user !== undefined || cfg.pass !== undefined) {
      if (!cfg.user || !cfg.pass) throw new SmtpError('auth', 'SMTP user and pass must be set together');
      if (!tlsActive) throw new SmtpError('auth', 'refusing to AUTH without TLS (use port 465 or a server with STARTTLS)');
      if (caps.auth.includes('PLAIN')) {
        await cmd('AUTH PLAIN ' + btoa(String.fromCharCode(...enc.encode(`\0${cfg.user}\0${cfg.pass}`))));
        await expect('auth', [235]);
      } else if (caps.auth.includes('LOGIN')) {
        const b = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
        await cmd('AUTH LOGIN');
        await expect('auth', [334]);
        await cmd(b(cfg.user));
        await expect('auth', [334]);
        await cmd(b(cfg.pass));
        await expect('auth', [235]);
      } else {
        throw new SmtpError('auth', 'server offers no AUTH PLAIN/LOGIN');
      }
    }

    await cmd(`MAIL FROM:<${cfg.from}>`);
    await expect('mail_from', [250]);
    for (const rcpt of cfg.to) {
      await cmd(`RCPT TO:<${rcpt}>`);
      await expect('rcpt_to', [250, 251]);
    }
    await cmd('DATA');
    await expect('data', [354]);
    // CRLF 正規化＋dot-stuffing
    const body = message.split(/\r\n|\r|\n/).map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
    await conn.write(enc.encode(body.replace(/(\r\n)*$/, '') + '\r\n.\r\n'));
    await expect('data_end', [250]);
    try { await cmd('QUIT'); } catch { /* 信已被接受，QUIT 失敗無所謂 */ }
  })();
  work.catch(() => {}); // 競賽輸掉之後的拒絕不要變成 unhandled rejection

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SmtpError('timeout', `SMTP timeout after ${timeoutMs}ms`));
      try { conn?.close(); } catch { /* ignore */ }
    }, timeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* ignore */ }
  }
}

