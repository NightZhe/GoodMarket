import { describe, expect, it } from 'vitest';
import {
  buildMime, buildSubject, buildText, encodeHeader, parseMailbox, parseRecipients, targetLink, taipeiTime, type ReportRow,
} from './mail.ts';

const PID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const RID = '33333333-3333-4333-8333-333333333333';
const base: ReportRow = {
  id: RID, target_type: 'product', target_id: PID, target_label: '手工皂 禮盒', target_shop_id: SID,
  reason: 'scam', details: '價格與描述不符', created_at: '2026-10-25T12:05:03.123456+00:00', notified_at: null, notify_attempts: 0,
};

describe('主旨與內文（R-K8）', () => {
  it('主旨：[好物集] 新檢舉：<目標類型> <原因>', () => {
    expect(buildSubject(base)).toBe('[好物集] 新檢舉：商品 詐騙或不實資訊');
    expect(buildSubject({ ...base, target_type: 'review', reason: 'other' })).toBe('[好物集] 新檢舉：評價 其他');
    expect(buildSubject({ ...base, target_type: 'shop', reason: 'harassment' })).toBe('[好物集] 新檢舉：店家 騷擾、仇恨或洩露個資');
  });
  it('主旨不含目標名稱（使用者輸入）', () => {
    expect(buildSubject({ ...base, target_label: 'x\r\nBcc: evil@x.com' })).not.toContain('Bcc');
  });
  it('內文含編號、台北時間、類型、名稱、連結、原因、說明', () => {
    const t = buildText(base, null);
    expect(t).toContain(`檢舉編號：${RID}`);
    expect(t).toContain('時間（台北）：2026-10-25 20:05:03');
    expect(t).toContain('目標類型：商品');
    expect(t).toContain('目標名稱：手工皂 禮盒');
    expect(t).toContain(`目標連結：https://nightzhe.github.io/GoodMarket/#/product/${PID}`);
    expect(t).toContain('原因：詐騙或不實資訊');
    expect(t).toContain('價格與描述不符');
  });
  it('沒填說明 → （未填）；說明保留換行', () => {
    expect(buildText({ ...base, details: null }, null)).toContain('說明：\n（未填）');
    expect(buildText({ ...base, details: '第一行\n第二行' }, null)).toContain('第一行\n第二行');
  });
  it('目標名稱的換行被壓平', () => {
    expect(buildText({ ...base, target_label: 'a\nb' }, null)).toContain('目標名稱：a b');
  });
  it('不含檢舉人資料：即使 row 被塞了 reporter_id／email 也不會印出', () => {
    const dirty = { ...base, reporter_id: '99999999-9999-4999-8999-999999999999', email: 'who@example.com', phone: '+886912345678' } as unknown as ReportRow;
    const t = buildText(dirty, null) + buildSubject(dirty);
    expect(t).not.toContain('99999999-9999');
    expect(t).not.toContain('who@example.com');
    expect(t).not.toContain('886912345678');
  });
});

describe('台北時間', () => {
  it('UTC+8、跨日', () => {
    expect(taipeiTime('2026-10-25T16:30:00Z')).toBe('2026-10-26 00:30:00');
    expect(taipeiTime('2026-12-31T16:00:00+00:00')).toBe('2027-01-01 00:00:00');
  });
  it('看不懂的時間原樣回傳', () => { expect(taipeiTime('not a date')).toBe('not a date'); });
});

describe('目標連結', () => {
  it('商品、店家', () => {
    expect(targetLink(base, null)).toBe(`https://nightzhe.github.io/GoodMarket/#/product/${PID}`);
    expect(targetLink({ ...base, target_type: 'shop', target_id: SID }, null)).toBe(`https://nightzhe.github.io/GoodMarket/#/shop/${SID}`);
  });
  it('評價 → 所屬商品的評價總覽；查不到商品 → 店家頁', () => {
    const r = { ...base, target_type: 'review', target_id: RID };
    expect(targetLink(r, PID)).toBe(`https://nightzhe.github.io/GoodMarket/#/product/${PID}/reviews`);
    expect(targetLink(r, null)).toBe(`https://nightzhe.github.io/GoodMarket/#/shop/${SID}`);
    expect(targetLink(r, 'not-a-uuid')).toBe(`https://nightzhe.github.io/GoodMarket/#/shop/${SID}`);
  });
});

describe('信箱位址', () => {
  it('合法與不合法', () => {
    expect(parseMailbox('a@b.co')).toEqual({ addr: 'a@b.co' });
    expect(parseMailbox('好物集 <a@b.co>')).toEqual({ name: '好物集', addr: 'a@b.co' });
    expect(parseMailbox('"Good Market" <a@b.co>')).toEqual({ name: 'Good Market', addr: 'a@b.co' });
    for (const bad of [undefined, '', 'nope', 'a@', '@b.co', 'a b@c.co', 'a@b.co\r\nBcc: x@y.z', '<a@b.co', 'a@b.co,c@d.co']) {
      expect(parseMailbox(bad), String(bad)).toBeNull();
    }
  });
  it('收件人清單', () => {
    expect(parseRecipients('a@b.co')).toEqual(['a@b.co']);
    expect(parseRecipients('a@b.co, c@d.co')).toEqual(['a@b.co', 'c@d.co']);
    expect(parseRecipients('a@b.co,bad')).toBeNull();
    expect(parseRecipients('')).toBeNull();
    expect(parseRecipients('x <a@b.co>')).toBeNull();
    expect(parseRecipients('1@a.co,2@a.co,3@a.co,4@a.co,5@a.co,6@a.co')).toBeNull();
  });
});

describe('MIME', () => {
  it('非 ASCII 標頭用 RFC 2047；每個 encoded-word ≤ 75 字元', () => {
    const h = encodeHeader('[好物集] 新檢舉：店家 騷擾、仇恨或洩露個資 '.repeat(3));
    for (const w of h.split('\r\n ')) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = h.split('\r\n ').map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
    expect(decoded).toBe('[好物集] 新檢舉：店家 騷擾、仇恨或洩露個資 '.repeat(3).trim());
  });
  it('純 ASCII 標頭原樣', () => { expect(encodeHeader('Hello')).toBe('Hello'); });
  it('標頭注入：主旨裡的換行被壓平', () => {
    expect(encodeHeader('a\r\nBcc: x@y.z')).not.toMatch(/\r|\n/);
  });
  it('完整信件：標頭、base64 內文（每行 ≤ 76）、解回來等於原文', () => {
    const text = buildText(base, null);
    const raw = buildMime({ from: { name: '好物集', addr: 'noreply@example.com' }, to: ['site@example.com'], subject: buildSubject(base), text, date: new Date('2026-10-25T12:05:03Z'), messageId: 'abc' });
    const [head, body] = raw.split('\r\n\r\n');
    expect(head).toContain('To: site@example.com');
    expect(head).toContain('From: =?UTF-8?B?');
    expect(head).toContain('<noreply@example.com>');
    expect(head).toContain('Date: Sun, 25 Oct 2026 12:05:03 +0000');
    expect(head).toContain('Message-ID: <abc@example.com>');
    expect(head).toContain('Content-Type: text/plain; charset=UTF-8');
    for (const l of body.trim().split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(text.replace(/\n/g, '\r\n'));
  });
});
