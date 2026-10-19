import { describe, expect, it } from 'vitest';
import { ECPAY_FIELD_LABELS, labelEcpayFields } from './ecpayA11y';

// 綠界 SDK 把輸入框畫在我們的 DOM 裡（不是 iframe），但沒有程式化標籤：讀屏只會念 placeholder（AC-B22）。
// 這裡用最小的假 DOM 驗證：每個欄位依 class 補上 aria-label。
const fakeRoot = (classes: string[]) => {
  const els = new Map(classes.map(c => [c, { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, hasAttribute(k: string) { return k in this.attrs; } }]));
  return { root: { querySelector: (sel: string) => els.get(sel.replace(/^\./, '')) ?? null }, els };
};

describe('labelEcpayFields', () => {
  it('四個欄位（卡號、有效期限、安全碼、持卡人姓名）各補上中文 aria-label', () => {
    const { root, els } = fakeRoot(Object.keys(ECPAY_FIELD_LABELS));
    expect(labelEcpayFields(root)).toBe(4);
    for (const [cls, label] of Object.entries(ECPAY_FIELD_LABELS)) expect(els.get(cls)!.attrs['aria-label']).toBe(label);
  });
  it('標籤文字：卡號、有效期限、安全碼、持卡人姓名都有，且不是 placeholder 的數字', () => {
    const all = Object.values(ECPAY_FIELD_LABELS).join('|');
    for (const w of ['信用卡號', '有效期限', '安全碼', '持卡人姓名']) expect(all).toContain(w);
    for (const l of Object.values(ECPAY_FIELD_LABELS)) expect(l).not.toMatch(/^[0-9 /]+$/);
  });
  it('欄位還沒畫出來（找不到）：回傳已補的數量，不丟錯', () => {
    const { root } = fakeRoot(['ecpay-cc-card']);
    expect(labelEcpayFields(root)).toBe(1);
    expect(labelEcpayFields({ querySelector: () => null })).toBe(0);
  });
  it('綠界自己已經給了 aria-label 就不覆蓋', () => {
    const { root, els } = fakeRoot(['ecpay-cc-card']);
    els.get('ecpay-cc-card')!.attrs['aria-label'] = '綠界給的';
    labelEcpayFields(root);
    expect(els.get('ecpay-cc-card')!.attrs['aria-label']).toBe('綠界給的');
  });
});
