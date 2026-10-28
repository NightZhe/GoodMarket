import { describe, expect, it } from 'vitest';
import { classifyPickError } from './photos';

describe('原生相簿選圖的錯誤分類（R-M8a、設計 4.4）', () => {
  it('使用者關掉選擇器：不算錯，什麼都不顯示', () => {
    expect(classifyPickError({ message: 'User cancelled photos app' })).toBe('cancelled');
    expect(classifyPickError({ code: 'OS-PLUG-CAMR-0006', message: 'No image picked' })).toBe('cancelled');
    expect(classifyPickError(new Error('canceled'))).toBe('cancelled');
  });
  it('相簿權限被拒或受限：提示到設定允許存取', () => {
    expect(classifyPickError({ message: 'User denied access to photos' })).toBe('denied');
    expect(classifyPickError({ message: 'Photo library permission was not granted' })).toBe('denied');
  });
  it('其他失敗一律走「無法開啟相簿」同一句提示', () => {
    expect(classifyPickError(new Error('boom'))).toBe('failed');
    expect(classifyPickError('weird')).toBe('failed');
    expect(classifyPickError(undefined)).toBe('failed');
  });
});
