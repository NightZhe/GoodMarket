import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../auth/pending';
import { FORM_DRAFT_KEY, FORM_DRAFT_TTL_MS, saveFormDraft, takeFormDraft, type FormDraft } from './formDraft';

const mem = (opts: { failWrite?: boolean } = {}): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (opts.failWrite) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
};

const NOW = 1_800_000_000_000;
const profile: FormDraft = { kind: 'profile', nickname: '小花貓' };
const address: FormDraft = {
  kind: 'address', id: null, isDefault: true,
  value: { recipient: '王小明', phone: '0912-345-678', city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓' },
};

// R-A16：登入過期時，個人檔案與地址表單的輸入不能消失。登入是整頁跳轉，所以輸入要暫存起來、登入回來只還原一次。
describe('表單草稿（登入過期時保留輸入）', () => {
  it('存了再取：內容一致，取過就刪（重新整理不會再還原第二次）', () => {
    const s = mem();
    expect(saveFormDraft(s, profile, NOW)).toBe(true);
    expect(takeFormDraft(s, NOW)).toEqual(profile);
    expect(s.data.has(FORM_DRAFT_KEY)).toBe(false);
    expect(takeFormDraft(s, NOW)).toBeNull();
  });
  it('地址草稿連編輯的是哪一筆、預設勾選一起保存', () => {
    const s = mem();
    saveFormDraft(s, { ...address, id: 'a-1' }, NOW);
    expect(takeFormDraft(s, NOW)).toEqual({ ...address, id: 'a-1' });
  });
  it('超過 60 分鐘就丟掉（登入花太久，不要把舊個資憑空還原）', () => {
    const s = mem();
    saveFormDraft(s, profile, NOW);
    expect(takeFormDraft(s, NOW + FORM_DRAFT_TTL_MS)).toBeNull();
    expect(s.data.has(FORM_DRAFT_KEY)).toBe(false);
  });
  it('只保留最新一筆', () => {
    const s = mem();
    saveFormDraft(s, profile, NOW);
    saveFormDraft(s, address, NOW + 1);
    expect(takeFormDraft(s, NOW + 2)).toEqual(address);
  });
  it.each([
    ['不是 JSON', '{x'],
    ['未知種類', JSON.stringify({ kind: 'hack', createdAt: NOW })],
    ['暱稱不是字串', JSON.stringify({ kind: 'profile', nickname: 5, createdAt: NOW })],
    ['地址欄位缺漏', JSON.stringify({ kind: 'address', id: null, isDefault: false, value: { recipient: 'x' }, createdAt: NOW })],
    ['沒有時間', JSON.stringify({ kind: 'profile', nickname: 'x' })],
  ])('壞資料當作沒有，而且被刪掉：%s', (_l, raw) => {
    const s = mem();
    s.setItem(FORM_DRAFT_KEY, raw);
    expect(takeFormDraft(s, NOW)).toBeNull();
    expect(s.data.has(FORM_DRAFT_KEY)).toBe(false);
  });
  it('儲存空間被擋：存回傳 false、取回傳 null，都不丟例外', () => {
    expect(saveFormDraft(mem({ failWrite: true }), profile, NOW)).toBe(false);
    const bad: StorageLike = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(takeFormDraft(bad, NOW)).toBeNull();
  });
});
