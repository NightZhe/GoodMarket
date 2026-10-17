import { describe, expect, it } from 'vitest';
import { handoffWhenLoggedIn, handoffWhenLoggedOut, mayRunPending } from './handoff';
import { PENDING_TTL_MS, buildPending, paramsToPending } from './pending';

const NOW = 1_800_000_000_000;
const cart = buildPending({ kind: 'add_to_cart', productId: 'p1', variantId: 'v1', qty: 5 }, '/', NOW);
const buy = buildPending({ kind: 'buy_now', productId: 'p1', variantId: 'v1', qty: 5 }, '/', NOW);

describe('B-2：網址參數不能讓任何人的連結自動替已登入的人動作', () => {
  it('只有「剛登入回來」可以自動執行待辦動作；網址帶參數、一般載入、取消、失敗都不行', () => {
    expect(mayRunPending('signed_in')).toBe(true);
    for (const o of ['none', 'cancelled', 'failed', null] as const) expect(mayRunPending(o)).toBe(false);
  });

  it('已登入的人打開 ?pa=cart 或 ?pa=buy 的連結：只會要求確認，不會執行', () => {
    const fromCart = paramsToPending(new URLSearchParams('pa=cart&pp=p1&pv=v1&pq=5'), '/product/p1', NOW);
    const fromBuy = paramsToPending(new URLSearchParams('pa=buy&pp=p1&pv=v1&pq=5'), '/product/p1', NOW);
    expect(handoffWhenLoggedIn(fromCart)).toBe('confirm');
    expect(handoffWhenLoggedIn(fromBuy)).toBe('confirm');
    // 而且網址帶參數的載入，登入結果是 none，所以 PendingRunner 一定不會取用
    expect(mayRunPending('none')).toBe(false);
  });

  it('已登入且只是純登入的連結（pa=login）：什麼都不做', () => {
    expect(handoffWhenLoggedIn(paramsToPending(new URLSearchParams('pa=login'), '/orders', NOW))).toBe('none');
    expect(handoffWhenLoggedIn(null)).toBe('none');
  });

  it('沒登入：開登入面板（使用者按登入鈕才算數）；連結過期只預填', () => {
    expect(handoffWhenLoggedOut(cart, NOW)).toBe('login_panel');
    expect(handoffWhenLoggedOut(buy, NOW + PENDING_TTL_MS)).toBe('prefill_only');
    expect(handoffWhenLoggedOut(null, NOW)).toBe('none');
  });
});
