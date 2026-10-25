import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_URL, FRAME_MSG, frameEventToTs, frameOrigin, frameSrc, parseFrameMessage } from './turnstileFrame';

const ORIGIN = 'https://nightzhe.github.io';

describe('iframe 網址', () => {
  it('預設正式站的 captcha-frame.html，sitekey 放 query', () => {
    expect(frameSrc(DEFAULT_FRAME_URL, '0x4AAAAAAFh8HZ6cfA1LLg9i')).toBe('https://nightzhe.github.io/GoodMarket/captcha-frame.html?sitekey=0x4AAAAAAFh8HZ6cfA1LLg9i');
    expect(frameOrigin(DEFAULT_FRAME_URL)).toBe(ORIGIN);
  });
  it('本機 dev server 也行（模擬器連 Mac 的 localhost）', () => {
    expect(frameSrc('http://localhost:5173/captcha-frame.html', '1x00000000000000000000AA')).toBe('http://localhost:5173/captcha-frame.html?sitekey=1x00000000000000000000AA');
    expect(frameOrigin('http://localhost:5173/captcha-frame.html')).toBe('http://localhost:5173');
  });
});

describe('parseFrameMessage：只收正式站來源、只收我們的格式', () => {
  it('token', () => {
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'token', token: 'abc' }, ORIGIN, ORIGIN)).toEqual({ event: 'token', token: 'abc' });
  });
  it('來源不對一律丟掉（別的網域、capacitor 自己、null）', () => {
    const m = { type: FRAME_MSG, event: 'token', token: 'abc' };
    expect(parseFrameMessage(m, 'https://evil.example', ORIGIN)).toBeNull();
    expect(parseFrameMessage(m, 'capacitor://nightzhe.github.io', ORIGIN)).toBeNull();
    expect(parseFrameMessage(m, 'null', ORIGIN)).toBeNull();
    expect(parseFrameMessage(m, 'http://nightzhe.github.io', ORIGIN)).toBeNull();
  });
  it('格式不對丟掉：不是物件、type 不對、空 token、高度不是數字', () => {
    expect(parseFrameMessage('token', ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage(null, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: 'other', event: 'token', token: 'abc' }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'token', token: '' }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'token' }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'height', height: 'tall' }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'height', height: -1 }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'unknown' }, ORIGIN, ORIGIN)).toBeNull();
  });
  it('其他事件', () => {
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'loaded' }, ORIGIN, ORIGIN)).toEqual({ event: 'loaded' });
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'height', height: 65 }, ORIGIN, ORIGIN)).toEqual({ event: 'height', height: 65 });
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'error', code: '110200' }, ORIGIN, ORIGIN)).toEqual({ event: 'error', code: '110200' });
    expect(parseFrameMessage({ type: FRAME_MSG, event: 'error' }, ORIGIN, ORIGIN)).toEqual({ event: 'error', code: '' });
    for (const event of ['interactive', 'after-interactive', 'expired', 'timeout', 'script-failed'] as const) {
      expect(parseFrameMessage({ type: FRAME_MSG, event }, ORIGIN, ORIGIN)).toEqual({ event });
    }
  });
});

describe('對到既有狀態機（design C-2 六種狀態）', () => {
  it('狀態事件', () => {
    expect(frameEventToTs({ event: 'token', token: 'x' })).toEqual({ type: 'token' });
    expect(frameEventToTs({ event: 'interactive' })).toEqual({ type: 'interactive' });
    expect(frameEventToTs({ event: 'error', code: '' })).toEqual({ type: 'error' });
    expect(frameEventToTs({ event: 'expired' })).toEqual({ type: 'expired' });
    expect(frameEventToTs({ event: 'timeout' })).toEqual({ type: 'timeout' });
    expect(frameEventToTs({ event: 'script-failed' })).toEqual({ type: 'script-failed' });
  });
  it('loaded／height／after-interactive 不改狀態', () => {
    expect(frameEventToTs({ event: 'loaded' })).toBeNull();
    expect(frameEventToTs({ event: 'height', height: 0 })).toBeNull();
    expect(frameEventToTs({ event: 'after-interactive' })).toBeNull();
  });
});
