import { describe, expect, it } from 'vitest';
import { runPool, transferImage, type TransferDeps } from './images';

const signal = new AbortController().signal;
const noSleep = async () => {};

function deps(over: Partial<TransferDeps> = {}): TransferDeps & { calls: { fetch: number; upload: number } } {
  const calls = { fetch: 0, upload: 0 };
  return {
    calls,
    fetchAndCompress: async () => { calls.fetch++; return new Blob(['x']); },
    upload: async () => { calls.upload++; return 'http://local/a.jpg'; },
    sleep: noSleep,
    ...over,
  };
}

describe('transferImage', () => {
  it('成功：回傳上傳後的網址', async () => {
    const d = deps();
    expect(await transferImage('https://cdn/x', d, signal)).toEqual({ ok: true, url: 'http://local/a.jpg' });
    expect(d.calls).toEqual({ fetch: 1, upload: 1 });
  });

  it('下載失敗兩次、第三次成功：不算失敗', async () => {
    let n = 0;
    const d = deps({ fetchAndCompress: async () => { if (++n < 3) throw new Error('boom'); return new Blob(['x']); } });
    expect((await transferImage('u', d, signal)).ok).toBe(true);
    expect(n).toBe(3);
  });

  it('下載一直失敗：共試 3 次後回 IMAGE_DOWNLOAD_FAILED，沒有嘗試上傳', async () => {
    let n = 0;
    const d = deps({ fetchAndCompress: async () => { n++; throw new Error('HTTP 404'); } });
    expect(await transferImage('u', d, signal)).toEqual({ ok: false, code: 'IMAGE_DOWNLOAD_FAILED' });
    expect(n).toBe(3);
    expect(d.calls.upload).toBe(0);
  });

  it('上傳一直失敗：回 IMAGE_UPLOAD_FAILED，且不會重新下載', async () => {
    let n = 0;
    const d = deps({ upload: async () => { n++; throw new Error('storage down'); } });
    expect(await transferImage('u', d, signal)).toEqual({ ok: false, code: 'IMAGE_UPLOAD_FAILED' });
    expect(n).toBe(3);
    expect(d.calls.fetch).toBe(1);
  });

  it('已取消：丟 AbortError，不當成失敗', async () => {
    const ctl = new AbortController();
    const d = deps({ fetchAndCompress: async () => { ctl.abort(); throw new Error('x'); } });
    await expect(transferImage('u', d, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('runPool', () => {
  it('同時最多 N 件，全部做完', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n); running--;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('有一件丟例外：不再取新件、等進行中的做完，再丟出第一個例外', async () => {
    const started: number[] = [];
    await expect(runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 5));
      if (n === 2) throw new Error('壞了');
    })).rejects.toThrow('壞了');
    expect(started.length).toBeLessThan(6);
  });
});
