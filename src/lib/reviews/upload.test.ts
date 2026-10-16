import { describe, expect, it } from 'vitest';
import { ReviewError } from './errors';
import { StorageUploadError, uploadPhoto, type UploadDeps } from './upload';
import type { UploadSlot } from './types';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const slot = (path: string, minutes = 30): UploadSlot => ({ path, expires_at: new Date(NOW + minutes * 60_000).toISOString() });
const blob = new Blob(['x']);

function deps(over: Partial<UploadDeps> = {}): UploadDeps & { log: string[] } {
  const log: string[] = [];
  let n = 0;
  return {
    log,
    now: () => NOW,
    requestSlot: async () => { log.push('request'); return slot(`new-${++n}.jpg`); },
    upload: async (path) => { log.push(`upload:${path}`); },
    ...over,
  };
}

describe('uploadPhoto', () => {
  it('沒有位置：先申請再上傳', async () => {
    const d = deps();
    const r = await uploadPhoto(blob, null, d);
    expect(r).toMatchObject({ ok: true, path: 'new-1.jpg' });
    expect(d.log).toEqual(['request', 'upload:new-1.jpg']);
  });

  it('手上的位置還有效：重試時沿用，不多申請（累計上限只有 15 個）', async () => {
    const d = deps();
    const r = await uploadPhoto(blob, slot('keep.jpg', 20), d);
    expect(r).toMatchObject({ ok: true, path: 'keep.jpg' });
    expect(d.log).toEqual(['upload:keep.jpg']);
  });

  it('手上的位置快過期：換新的', async () => {
    const d = deps();
    const r = await uploadPhoto(blob, slot('old.jpg', 0.5), d);
    expect(r).toMatchObject({ ok: true, path: 'new-1.jpg' });
  });

  it('403（位置失效）：自動重新申請、重傳一次，成功就算成功（AC-72）', async () => {
    let calls = 0;
    const d = deps({
      upload: async (path) => { calls++; if (calls === 1) throw new StorageUploadError('new row violates RLS', 403); d.log.push(`upload:${path}`); },
    });
    const r = await uploadPhoto(blob, slot('stale.jpg'), d);
    expect(r).toMatchObject({ ok: true, path: 'new-1.jpg' });
    expect(d.log).toEqual(['request', 'upload:new-1.jpg']);
  });

  it('403 兩次：回報逾時，不再重試', async () => {
    const d = deps({ upload: async () => { throw new StorageUploadError('rls', 403); } });
    const r = await uploadPhoto(blob, slot('stale.jpg'), d);
    expect(r).toMatchObject({ ok: false, reason: 'expired' });
    expect(d.log.filter(x => x === 'request')).toHaveLength(1);
  });

  it('409（檔案已存在）：視為上次其實傳成功了', async () => {
    const d = deps({ upload: async () => { throw new StorageUploadError('exists', 409); } });
    expect(await uploadPhoto(blob, slot('a.jpg'), d)).toMatchObject({ ok: true, path: 'a.jpg' });
  });

  it('413／415：檔案本身不行，不能重試', async () => {
    for (const status of [413, 415]) {
      const d = deps({ upload: async () => { throw new StorageUploadError('no', status); } });
      expect(await uploadPhoto(blob, null, d)).toMatchObject({ ok: false, reason: 'unusable' });
    }
  });

  it('沒有狀態碼（斷網）：可重試，並保留位置', async () => {
    const d = deps({ upload: async () => { throw new TypeError('Failed to fetch'); } });
    const r = await uploadPhoto(blob, null, d);
    expect(r).toMatchObject({ ok: false, reason: 'network', slot: { path: 'new-1.jpg' } });
  });

  it('申請位置時：累計上限 → limit；其他資料庫錯誤 → fatal；沒有錯誤碼 → network', async () => {
    const fail = (e: unknown) => deps({ requestSlot: async () => { throw e; } });
    expect(await uploadPhoto(blob, null, fail(new ReviewError('x', 'UPLOAD_LIMIT_EXCEEDED')))).toMatchObject({ ok: false, reason: 'limit' });
    expect(await uploadPhoto(blob, null, fail(new ReviewError('x', 'REVIEW_EXPIRED')))).toMatchObject({ ok: false, reason: 'fatal' });
    expect(await uploadPhoto(blob, null, fail(new ReviewError('Failed to fetch', null)))).toMatchObject({ ok: false, reason: 'network' });
  });
});
