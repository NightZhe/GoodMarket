import { describe, expect, it } from 'vitest';
import { MAX_CHAT_PHOTOS, compressedPhotoError, planChatIntake } from './images';

const MB = 1024 * 1024;
const img = (n: string, size = MB) => ({ name: n, type: 'image/jpeg', size });

describe('選圖檢查（R-M8、AC-M9）', () => {
  it('一則最多 5 張', () => {
    expect(MAX_CHAT_PHOTOS).toBe(5);
  });
  it('3 張都可以：全收、沒有提示', () => {
    const p = planChatIntake([img('a'), img('b'), img('c')], 0);
    expect(p.accepted).toEqual([0, 1, 2]);
    expect(p.error).toBeNull();
  });
  it('一次選 6 張：收前 5 張，提示「圖片最多 5 張」', () => {
    const p = planChatIntake(Array.from({ length: 6 }, (_, i) => img(`${i}`)), 0);
    expect(p.accepted).toEqual([0, 1, 2, 3, 4]);
    expect(p.error).toBe('圖片最多 5 張');
  });
  it('已經有 4 張再選 3 張：只收 1 張', () => {
    const p = planChatIntake([img('a'), img('b'), img('c')], 4);
    expect(p.accepted).toEqual([0]);
    expect(p.error).toBe('圖片最多 5 張');
  });
  it('已滿 5 張再選：一張都不收，仍提示張數', () => {
    const p = planChatIntake([img('a')], 5);
    expect(p.accepted).toEqual([]);
    expect(p.error).toBe('圖片最多 5 張');
  });
  it('不是圖片：不收，提示「請選擇圖片檔」', () => {
    const p = planChatIntake([{ name: 'a.pdf', type: 'application/pdf', size: 1000 }], 0);
    expect(p.accepted).toEqual([]);
    expect(p.error).toBe('請選擇圖片檔');
  });
  it('type 空白但副檔名是 HEIC 照樣當圖片（部分瀏覽器選到 HEIC 時 type 是空字串）', () => {
    expect(planChatIntake([{ name: 'IMG_1.HEIC', type: '', size: MB }], 0).accepted).toEqual([0]);
  });
  it('原圖超過 20MB 直接擋：提示「圖片檔案太大（上限 20MB）」', () => {
    const p = planChatIntake([img('big', 25 * MB), img('ok')], 0);
    expect(p.accepted).toEqual([1]);
    expect(p.error).toBe('圖片檔案太大（上限 20MB）');
  });
  it('剛好 20MB 可以', () => {
    expect(planChatIntake([img('edge', 20 * MB)], 0).accepted).toEqual([0]);
  });
  it('同時有不同問題：先說不是圖片，再說太大，最後才是張數', () => {
    const files = [{ name: 'x.txt', type: 'text/plain', size: 1 }, img('big', 25 * MB)];
    expect(planChatIntake(files, 0).error).toBe('請選擇圖片檔');
    expect(planChatIntake([img('big', 25 * MB), ...Array.from({ length: 6 }, (_, i) => img(`${i}`))], 0).error).toBe('圖片檔案太大（上限 20MB）');
  });
});

describe('壓縮後的檢查（Storage 以 5MB 為硬上限）', () => {
  it('≤ 5MB 通過；超過就擋「單張圖片不能超過 5MB」', () => {
    expect(compressedPhotoError(5 * MB)).toBeNull();
    expect(compressedPhotoError(5 * MB + 1)).toBe('單張圖片不能超過 5MB');
  });
});
