import { describe, expect, it } from 'vitest';
import { TOKEN_WAIT_MS, tokenDecision, tsReduce, turnstileSize, type TsStatus } from './turnstileState';

describe('Turnstile 狀態（design C-2 六種狀態）', () => {
  it('載入中 → 通過隱形：callback 給 token 就是 ready，畫面上看不到任何東西', () => {
    expect(tsReduce('loading', { type: 'token' })).toBe('ready');
  });
  it('需要互動：before-interactive-callback', () => {
    expect(tsReduce('loading', { type: 'interactive' })).toBe('interactive');
  });
  it('互動完成後 token 到了 → ready', () => {
    expect(tsReduce('interactive', { type: 'token' })).toBe('ready');
  });
  it('已經有 token 時又收到 before-interactive：不要倒退成需要互動', () => {
    expect(tsReduce('ready', { type: 'interactive' })).toBe('ready');
  });
  it('失敗可重試：error-callback', () => {
    expect(tsReduce('loading', { type: 'error' })).toBe('failed');
    expect(tsReduce('interactive', { type: 'error' })).toBe('failed');
  });
  it('逾時自動重設：timeout-callback（還是要使用者勾選）', () => {
    expect(tsReduce('interactive', { type: 'timeout' })).toBe('timeout');
  });
  it('token 過期（300 秒）：靜默回到載入中重新取得，不顯示任何東西', () => {
    expect(tsReduce('ready', { type: 'expired' })).toBe('loading');
  });
  it('載入不了：腳本載入失敗、或按了傳送等 10 秒還沒 token', () => {
    expect(TOKEN_WAIT_MS).toBe(10_000);
    expect(tsReduce('loading', { type: 'script-failed' })).toBe('unavailable');
    expect(tsReduce('loading', { type: 'stuck' })).toBe('unavailable');
  });
  it('重試／重新載入：回到載入中；單次使用後 reset 也是載入中', () => {
    expect(tsReduce('failed', { type: 'retry' })).toBe('loading');
    expect(tsReduce('unavailable', { type: 'retry' })).toBe('loading');
    expect(tsReduce('ready', { type: 'consumed' })).toBe('loading');
  });
  it('停用（沒有 sitekey、或手機登入關閉）：什麼事件都維持停用', () => {
    for (const type of ['token', 'error', 'interactive', 'script-failed'] as const) expect(tsReduce('off', { type })).toBe('off');
  });
});

describe('按下傳送時怎麼辦', () => {
  const cases: [TsStatus, ReturnType<typeof tokenDecision>][] = [
    ['ready', 'send'], ['loading', 'wait'], ['interactive', 'interaction'], ['timeout', 'interaction'],
    ['failed', 'failed'], ['unavailable', 'unavailable'], ['off', 'send'],
  ];
  it.each(cases)('%s → %s', (status, d) => expect(tokenDecision(status)).toBe(d));
});

describe('widget 尺寸（design 2.2）：容器 < 300px 改 compact', () => {
  it('375 寬面板（343）、賣家卡（311）、桌機對話框（400）→ flexible', () => {
    for (const w of [343, 311, 400, 384, 300]) expect(turnstileSize(w)).toBe('flexible');
  });
  it('縮放 200% 的 156、295 → compact', () => {
    expect(turnstileSize(156)).toBe('compact');
    expect(turnstileSize(295)).toBe('compact');
    expect(turnstileSize(299)).toBe('compact');
  });
});
