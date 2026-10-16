import { describe, expect, it } from 'vitest';
import { fitWithin, intakeNotice, looksLikeImage, planIntake, type PickedFile } from './photos';

const img = (name: string, size = 1000, type = 'image/jpeg'): PickedFile => ({ name, type, size });

describe('planIntake', () => {
  it('一次選 6 張：只收 5 張，其餘算超出名額（AC-63）', () => {
    const plan = planIntake(Array.from({ length: 6 }, (_, i) => img(`${i}.jpg`)), 0);
    expect(plan.accepted).toEqual([0, 1, 2, 3, 4]);
    expect(plan.overflow).toBe(1);
  });

  it('已經有 3 張：只剩 2 個名額；已滿 5 張：一張都不收', () => {
    expect(planIntake([img('a'), img('b'), img('c')], 3).accepted).toEqual([0, 1]);
    expect(planIntake([img('a')], 5)).toMatchObject({ accepted: [], overflow: 1 });
  });

  it('不是圖片（PDF）與超過 20 MB 的直接拒絕，不佔名額（AC-65）', () => {
    const plan = planIntake([
      { name: 'a.pdf', type: 'application/pdf', size: 10 },
      img('big.jpg', 21 * 1024 * 1024),
      img('ok.jpg'),
    ], 0);
    expect(plan.notImage).toEqual(['a.pdf']);
    expect(plan.tooBig).toEqual(['big.jpg']);
    expect(plan.accepted).toEqual([2]);
  });

  it('剛好 20 MB 可以', () => {
    expect(planIntake([img('x.jpg', 20 * 1024 * 1024)], 0).accepted).toEqual([0]);
  });

  it('取消選取（沒有檔案）：什麼都沒有', () => {
    const plan = planIntake([], 2);
    expect(plan).toEqual({ accepted: [], notImage: [], tooBig: [], overflow: 0 });
    expect(intakeNotice(plan)).toBeNull();
  });
});

describe('looksLikeImage', () => {
  it('type 空字串的 HEIC 看副檔名', () => {
    expect(looksLikeImage({ name: 'IMG_1.HEIC', type: '', size: 1 })).toBe(true);
    expect(looksLikeImage({ name: 'notes.txt', type: '', size: 1 })).toBe(false);
    expect(looksLikeImage({ name: 'x.png', type: 'application/octet-stream', size: 1 })).toBe(false);
  });
});

describe('intakeNotice', () => {
  it('超出名額', () => {
    expect(intakeNotice({ accepted: [0, 1], notImage: [], tooBig: [], overflow: 3 })).toBe('最多 5 張，已加入前 2 張');
  });

  it('單一被拒絕的檔案點名；多個合併', () => {
    expect(intakeNotice({ accepted: [], notImage: ['a.pdf'], tooBig: [], overflow: 0 })).toBe('「a.pdf」不是圖片，已略過');
    expect(intakeNotice({ accepted: [], notImage: [], tooBig: ['b.jpg'], overflow: 0 })).toBe('「b.jpg」超過 20 MB，已略過');
    expect(intakeNotice({ accepted: [], notImage: ['a.pdf'], tooBig: ['b.jpg'], overflow: 0 }))
      .toBe('有 2 個檔案無法加入（不是圖片或超過 20 MB）');
  });
});

describe('fitWithin', () => {
  it('長邊縮到 1280，維持比例', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 960, height: 1280 });
  });

  it('比 1280 小就不放大', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('極端細長的圖，短邊至少 1 px', () => {
    expect(fitWithin(10000, 1).height).toBe(1);
  });
});
