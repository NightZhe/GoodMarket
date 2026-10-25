import { describe, expect, it } from 'vitest';
import { shouldShowEntryRow, shouldShowReturnPrompt } from './returnPrompt';
import type { ReturnSettings, ReturnStore } from './returnStore';

const aStore = { id: 'a', is_default: true } as ReturnStore;
const aPersonal = { recipient: '李小華' } as ReturnSettings['personal'];
const settings = (p: Partial<ReturnSettings>): ReturnSettings => ({ stores: [], personal: null, note: null, ...p });

describe('賣場總覽提示卡（R-L16、AC-L34）', () => {
  it('門市與個人地址都 0 筆：顯示', () => {
    expect(shouldShowReturnPrompt('ready', settings({}))).toBe(true);
  });
  it('只有退貨說明：仍然顯示（說明不算設定）', () => {
    expect(shouldShowReturnPrompt('ready', settings({ note: '請先聯絡' }))).toBe(true);
  });
  it('有任一筆門市或個人地址：不顯示', () => {
    expect(shouldShowReturnPrompt('ready', settings({ stores: [aStore] }))).toBe(false);
    expect(shouldShowReturnPrompt('ready', settings({ personal: aPersonal }))).toBe(false);
    expect(shouldShowReturnPrompt('ready', settings({ stores: [aStore], personal: aPersonal }))).toBe(false);
  });
  it('讀取中、讀取失敗、資料庫未升級：不顯示（寧可漏提醒不誤報，H-L5）', () => {
    for (const phase of ['loading', 'error', 'unavailable'] as const) {
      expect(shouldShowReturnPrompt(phase, null), phase).toBe(false);
      expect(shouldShowReturnPrompt(phase, settings({})), phase).toBe(false);
    }
  });
  it('phase 是 ready 但還沒有資料：不顯示', () => {
    expect(shouldShowReturnPrompt('ready', null)).toBe(false);
  });
});

describe('常駐入口列（手機）：提示卡沒有顯示的時候才顯示', () => {
  it('提示卡顯示時不出現；其他情況（設好了、讀取中、失敗、未升級）都出現', () => {
    expect(shouldShowEntryRow('ready', settings({}))).toBe(false);
    expect(shouldShowEntryRow('ready', settings({ stores: [aStore] }))).toBe(true);
    for (const phase of ['loading', 'error', 'unavailable'] as const) expect(shouldShowEntryRow(phase, null), phase).toBe(true);
  });
});
