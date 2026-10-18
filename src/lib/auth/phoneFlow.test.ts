import { describe, expect, it } from 'vitest';
import type { StorageLike } from './pending';
import {
  FLOW_KEY, FLOW_TTL_MS, RESEND_SECONDS, clearFlow, isGateRoute, lastSendAt, loadFlow, parseFlow, rememberSend, resendSecondsLeft, saveFlow, serializeFlow, type PhoneFlow,
} from './phoneFlow';

const memory = (): StorageLike & { dump: () => string } => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); }, dump: () => JSON.stringify([...m]) };
};
const NOW = 1_700_000_000_000;
const flow: PhoneFlow = { phone: '+886912345678', step: 'login', sentAt: NOW - 10_000, savedAt: NOW - 10_000 };

describe('重寄倒數（R-21：用保存的傳送時間算，不靠計時器累加）', () => {
  it('剛傳送 → 60 秒；過了 1 秒 → 59；到點 → 0', () => {
    expect(RESEND_SECONDS).toBe(60);
    expect(resendSecondsLeft(NOW, NOW)).toBe(60);
    expect(resendSecondsLeft(NOW, NOW + 1_000)).toBe(59);
    expect(resendSecondsLeft(NOW, NOW + 59_001)).toBe(1);
    expect(resendSecondsLeft(NOW, NOW + 60_000)).toBe(0);
    expect(resendSecondsLeft(NOW, NOW + 600_000)).toBe(0);
  });
  it('背景停了 40 秒回到前景，接著算（visibilitychange 重算）', () => {
    expect(resendSecondsLeft(NOW, NOW + 40_000)).toBe(20);
  });
  it('沒有傳送時間（我已經收到驗證碼）→ 立刻可以重新傳送', () => {
    expect(resendSecondsLeft(null, NOW)).toBe(0);
  });
  it('裝置時鐘被往回調：最多顯示 60 秒，不會變成好幾分鐘', () => {
    expect(resendSecondsLeft(NOW + 3_600_000, NOW)).toBe(60);
  });
});

describe('R-25 離開再回來：保存什麼（R-7：不存驗證碼與 Turnstile token）', () => {
  it('存取來回一致', () => {
    const s = memory();
    saveFlow(s, flow);
    expect(loadFlow(s, NOW)).toEqual(flow);
  });
  it('就算呼叫端不小心塞了驗證碼或 token，也不會被寫進去', () => {
    const dirty = { ...flow, code: '135790', token: '135790', captchaToken: 'XXXX.DUMMY.TOKEN.XXXX', otp: '654321' } as PhoneFlow;
    const raw = serializeFlow(dirty);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['phone', 'savedAt', 'sentAt', 'step']);
    expect(raw).not.toMatch(/135790|654321|DUMMY|captcha/i);
    const s = memory();
    saveFlow(s, dirty);
    expect(s.dump()).not.toMatch(/135790|654321|DUMMY|captcha/i);
  });
  it('儲存位置被擋（隱私設定丟例外）：不當機，回傳 false／null', () => {
    const blocked: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(saveFlow(blocked, flow)).toBe(false);
    expect(loadFlow(blocked, NOW)).toBeNull();
    expect(() => clearFlow(blocked)).not.toThrow();
    expect(loadFlow(null, NOW)).toBeNull();
  });
  it('超過驗證碼有效時間（300 秒）就清除', () => {
    const s = memory();
    saveFlow(s, flow);
    expect(FLOW_TTL_MS).toBe(300_000);
    expect(loadFlow(s, flow.sentAt! + 299_000)).not.toBeNull();
    expect(loadFlow(s, flow.sentAt! + 300_000)).toBeNull();
    expect(s.getItem(FLOW_KEY)).toBeNull();
  });
  it('沒有傳送時間（我已經收到驗證碼）：從進入那一刻起算 300 秒', () => {
    const f: PhoneFlow = { phone: '+886912345678', step: 'login', sentAt: null, savedAt: NOW };
    const s = memory();
    saveFlow(s, f);
    expect(loadFlow(s, NOW + 299_000)).toEqual(f);
    expect(loadFlow(s, NOW + 300_000)).toBeNull();
  });
  it('clearFlow 清掉', () => {
    const s = memory();
    saveFlow(s, flow);
    clearFlow(s);
    expect(loadFlow(s, NOW)).toBeNull();
  });
  it('壞資料一律丟掉：不是 JSON、門號不是台灣行動門號、步驟不認得、時間不合理', () => {
    for (const raw of [
      'not json', '[]', '{}',
      JSON.stringify({ ...flow, phone: '+85291234567' }),
      JSON.stringify({ ...flow, phone: '0912345678' }),
      JSON.stringify({ ...flow, step: 'delete' }),
      JSON.stringify({ ...flow, savedAt: 'x' }),
      JSON.stringify({ ...flow, sentAt: -5 }),
      JSON.stringify({ ...flow, savedAt: NOW + 3_600_000 }),
    ]) expect(parseFlow(raw, NOW), raw).toBeNull();
  });
  it('綁定步驟也可以存', () => {
    const f: PhoneFlow = { ...flow, step: 'bind' };
    expect(parseFlow(serializeFlow(f), NOW)).toEqual(f);
  });
});

describe('這個門號上一次傳送的時間（429 兩種意思要靠它分）', () => {
  it('記憶體有就用記憶體；沒有再看 R-25 保存的同一個門號；其他門號不借用', () => {
    expect(lastSendAt('+886911111111', null)).toBeNull();
    expect(lastSendAt('+886912345678', flow)).toBe(flow.sentAt);
    expect(lastSendAt('+886900000000', flow)).toBeNull();
    rememberSend('+886912345678', NOW);
    expect(lastSendAt('+886912345678', flow)).toBe(NOW);
  });
  it('「我已經收到驗證碼」保存的 sentAt 是 null → 當作不知道', () => {
    expect(lastSendAt('+886933333333', { phone: '+886933333333', step: 'login', sentAt: null, savedAt: NOW })).toBeNull();
  });
});

describe('哪些頁面本身就是登入閘門', () => {
  it('購物車、結帳、訂單（含評價）、帳號（含綁定）、賣家中心是閘門；首頁、商品頁、隱私政策不是', () => {
    for (const r of ['/cart', '/checkout', '/orders', '/orders/abc/review', '/account', '/account/phone', '/seller', '/seller/products']) expect(isGateRoute(r), r).toBe(true);
    for (const r of ['/', '/product/p001', '/search', '/privacy', '/shop/s1', '/cartoon', '/accounting']) expect(isGateRoute(r), r).toBe(false);
  });
});
