import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import banks from './banks.json';
import { BANK_LOGO_FILES, bankLogoUrl, parseLogosEnabled } from './bankLogos';

const ROOT = new URL('../../', import.meta.url).pathname;
type Rec = Record<string, string>;
const sources: Rec[] = JSON.parse(readFileSync(ROOT + 'scripts/data/bank-logos/sources.json', 'utf8'));
const FIELDS = ['bankCode', 'bankName', 'sourceUrl', 'sourcePage', 'acquiredAt', 'acquiredBy', 'file', 'format', 'sha256', 'modified', 'license'];

describe('logo 來源紀錄（AC-47）', () => {
  it('每筆紀錄的欄位齊全且非空', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const r of sources) for (const f of FIELDS) expect(r[f], `${r.bankCode}.${f}`).toBeTruthy();
  });
  it('SHA-256 與 public/bank-logos 裡的檔案一致', () => {
    for (const r of sources) {
      const path = ROOT + 'public/bank-logos/' + r.file;
      expect(existsSync(path), r.file).toBe(true);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), r.file).toBe(r.sha256);
    }
  });
  it('來源紀錄 ↔ BANK_LOGO_FILES 一對一（沒有紀錄的 logo 上不了）', () => {
    expect(Object.fromEntries(sources.map((r) => [r.bankCode, r.file]))).toEqual(BANK_LOGO_FILES);
  });
  it('紀錄的銀行代碼都在 banks.json，名稱與清單一致；常用 6 家都有 logo', () => {
    for (const r of sources) expect(banks.find((b) => b.code === r.bankCode)?.name, r.bankCode).toBe(r.bankName);
    for (const b of banks.filter((x) => x.common !== null)) expect(BANK_LOGO_FILES[b.code], b.code).toBeTruthy();
  });
});

describe('bankLogoUrl（AC-48、T3）', () => {
  it('開關開著＋有紀錄 → 網址', () => {
    expect(bankLogoUrl('822', true)).toMatch(/bank-logos\/822\.png$/);
    expect(bankLogoUrl('013', true)).toMatch(/bank-logos\/013\.svg$/);
  });
  it('開關關著 → null（即使有紀錄）', () => {
    expect(bankLogoUrl('822', false)).toBeNull();
  });
  it('沒有紀錄、原型鏈名稱、空字串 → null', () => {
    for (const c of ['004', '', 'constructor', '__proto__']) expect(bankLogoUrl(c, true)).toBeNull();
  });
  it('parseLogosEnabled：只有明確 true 才開；null／缺欄位／字串 "true"／錯誤物件都關', () => {
    expect(parseLogosEnabled({ logos_enabled: true })).toBe(true);
    for (const v of [null, undefined, {}, { logos_enabled: 'true' }, { logos_enabled: 1 }, { logos_enabled: false }, 'x', []]) expect(parseLogosEnabled(v)).toBe(false);
  });
});
