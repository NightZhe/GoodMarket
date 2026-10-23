import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from './webhook.ts';

// 測試用的簽章由 Node 的 createHmac 獨立算出（實作用的是 WebCrypto），secret 是隨手寫的假值。
const KEY = Buffer.from('0123456789abcdef0123456789abcdef'); // 32 bytes
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const KEY2 = Buffer.from('fedcba9876543210fedcba9876543210');
const SECRET2 = `v1,whsec_${KEY2.toString('base64')}`;

const NOW = 1_800_000_000; // 秒
const BODY = '{"user":{"phone":"+886912345678"},"sms":{"otp":"123456"}}';
const sig = (key: Buffer, id: string, ts: number, body: string) =>
  'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

const verify = (over: Partial<Parameters<typeof verifyWebhook>[0]> = {}) =>
  verifyWebhook({
    secrets: SECRET, id: 'msg_1', timestamp: String(NOW), signature: sig(KEY, 'msg_1', NOW, BODY),
    body: BODY, nowMs: NOW * 1000, ...over,
  });

describe('verifyWebhook（standard-webhooks）', () => {
  it('正確簽章通過', async () => {
    expect(await verify()).toBe(true);
  });

  it('body 被改過就失敗', async () => {
    expect(await verify({ body: BODY.replace('123456', '654321') })).toBe(false);
  });

  it('簽章用別把 secret 算的就失敗', async () => {
    expect(await verify({ signature: sig(KEY2, 'msg_1', NOW, BODY) })).toBe(false);
  });

  it('id 或 timestamp 被換掉就失敗（簽章綁定這兩個值）', async () => {
    expect(await verify({ id: 'msg_2' })).toBe(false);
    expect(await verify({ timestamp: String(NOW + 1) })).toBe(false);
  });

  it('時間戳過期（超過 5 分鐘）失敗，邊界 5 分鐘內通過', async () => {
    const old = NOW - 301;
    expect(await verify({ timestamp: String(old), signature: sig(KEY, 'msg_1', old, BODY) })).toBe(false);
    const edge = NOW - 300;
    expect(await verify({ timestamp: String(edge), signature: sig(KEY, 'msg_1', edge, BODY) })).toBe(true);
  });

  it('時間戳在未來超過 5 分鐘也失敗', async () => {
    const fut = NOW + 301;
    expect(await verify({ timestamp: String(fut), signature: sig(KEY, 'msg_1', fut, BODY) })).toBe(false);
  });

  it('時間戳不是整數秒就失敗', async () => {
    expect(await verify({ timestamp: 'abc' })).toBe(false);
    expect(await verify({ timestamp: '1.5e9' })).toBe(false);
  });

  it('多把 secret（空白分隔，輪替用）：任一把對就通過', async () => {
    const both = `${SECRET2}   ${SECRET}`;
    expect(await verify({ secrets: both })).toBe(true);
    expect(await verify({ secrets: `${SECRET2} ${SECRET2}` })).toBe(false);
  });

  it('多把 secret 用「|」分隔（Supabase 的輪替格式）也行，兩邊有沒有空白都可以', async () => {
    expect(await verify({ secrets: `${SECRET2}|${SECRET}` })).toBe(true);
    expect(await verify({ secrets: `${SECRET2} | ${SECRET}` })).toBe(true);
    expect(await verify({ secrets: `${SECRET2}|${SECRET2}` })).toBe(false);
  });

  it('標頭帶多個簽章（GoTrue 用「, 」串接，每個是 v1,<base64>）：任一個對就通過', async () => {
    const bad = sig(KEY2, 'msg_1', NOW, BODY);
    const good = sig(KEY, 'msg_1', NOW, BODY);
    expect(await verify({ signature: `${bad}, ${good}` })).toBe(true);
    expect(await verify({ signature: `${good} ${bad}` })).toBe(true);
    expect(await verify({ signature: `${bad}, ${bad}` })).toBe(false);
  });

  it('缺標頭、空簽章、非 v1 版本都失敗', async () => {
    expect(await verify({ id: null })).toBe(false);
    expect(await verify({ timestamp: null })).toBe(false);
    expect(await verify({ signature: null })).toBe(false);
    expect(await verify({ signature: '' })).toBe(false);
    expect(await verify({ signature: sig(KEY, 'msg_1', NOW, BODY).replace('v1,', 'v2,') })).toBe(false);
    expect(await verify({ signature: 'v1,' })).toBe(false);
    expect(await verify({ signature: 'v1,not-base64!!' })).toBe(false);
  });

  it('secret 沒設或壞掉（不是 base64）一律失敗，不丟例外', async () => {
    expect(await verify({ secrets: '' })).toBe(false);
    expect(await verify({ secrets: undefined })).toBe(false);
    expect(await verify({ secrets: 'v1,whsec_%%%' })).toBe(false);
  });

  it('secret 不帶 v1, 前綴或 whsec_ 前綴也認得（貼的時候少複製一段）', async () => {
    expect(await verify({ secrets: `whsec_${KEY.toString('base64')}` })).toBe(true);
    expect(await verify({ secrets: KEY.toString('base64') })).toBe(true);
  });
});
