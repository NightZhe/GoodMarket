import { describe, expect, it } from 'vitest';
import { headingFor, inAppLines } from './headings';
import { ALL_PROVIDERS } from './providers';

const base = { trigger: null, expired: false, inApp: null, ios: true } as const;

describe('登入面板說明（design 6：依實際可用的方式組合，R-13）', () => {
  it('Google、Apple、手機都開', () => {
    expect(headingFor({ ...base, providers: ALL_PROVIDERS }).description).toBe('用 Google、Apple 或手機號碼登入，不用設密碼。');
  });
  it('只有 Google＋手機／只有 Apple＋手機／只有手機', () => {
    expect(headingFor({ ...base, providers: { ...ALL_PROVIDERS, apple: false } }).description).toBe('用 Google 或手機號碼登入，不用設密碼。');
    expect(headingFor({ ...base, providers: { ...ALL_PROVIDERS, google: false } }).description).toBe('用 Apple 或手機號碼登入，不用設密碼。');
    expect(headingFor({ ...base, providers: { ...ALL_PROVIDERS, google: false, apple: false } }).description).toBe('用手機號碼登入，不用設密碼。');
  });
  it('手機被關：回到原本的說明，不提手機', () => {
    expect(headingFor({ ...base, providers: { ...ALL_PROVIDERS, phone: false } }).description).toBe('用 Google 或 Apple 一鍵登入，不用設密碼。');
    expect(headingFor({ ...base, providers: { ...ALL_PROVIDERS, phone: false, apple: false } }).description).toBe('用 Google 一鍵登入，不用設密碼。');
  });
  it('全部都關：暫時無法登入', () => {
    expect(headingFor({ ...base, providers: { google: false, apple: false, phone: false, email: false } }).description).toBe('登入功能暫時無法使用，請稍後再試。');
  });
  it('標題跟著待辦動作', () => {
    const trigger = { kind: 'add_to_cart', productId: 'p', variantId: 'v', qty: 1 } as const;
    expect(headingFor({ ...base, trigger }).title).toBe('登入後才能加入購物車');
    expect(headingFor({ ...base, trigger: { ...trigger, kind: 'buy_now' } }).title).toBe('登入後才能購買');
    expect(headingFor({ ...base, expired: true }).title).toBe('登入已過期');
    expect(headingFor({ ...base, expired: true }).description).toBe('請重新登入。你剛才填的內容都還在。');
    expect(headingFor(base).title).toBe('登入好物集');
  });
});

describe('內建瀏覽器（P12：以手機號碼為主）', () => {
  it('LINE：標題不再叫人先換瀏覽器', () => {
    const h = headingFor({ ...base, inApp: 'line' });
    expect(h.title).toBe('用手機號碼登入');
    expect(h.description).toBe('LINE 裡無法使用 Google 登入。你可以直接用手機號碼登入，或改用 Safari 開啟後再用 Google 或 Apple 登入。');
  });
  it('FB／IG 與 Android 的 LINE 說「瀏覽器」', () => {
    expect(headingFor({ ...base, inApp: 'facebook' }).description).toBe('Facebook、Instagram 裡無法使用 Google 登入。你可以直接用手機號碼登入，或改用瀏覽器開啟後再用 Google 或 Apple 登入。');
    expect(inAppLines('line', false).rest).toContain('改用瀏覽器開啟');
  });
  it('手機登入被關掉：維持原本叫人換瀏覽器的說法', () => {
    expect(headingFor({ ...base, inApp: 'line', providers: { ...ALL_PROVIDERS, phone: false } }).title).toBe('請改用 Safari 登入');
    expect(headingFor({ ...base, inApp: 'instagram', providers: { ...ALL_PROVIDERS, phone: false } }).title).toBe('請改用瀏覽器開啟');
  });
});
