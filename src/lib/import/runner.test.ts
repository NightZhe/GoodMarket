import { describe, expect, it } from 'vitest';
import type {
  ImportBatchResult, ImportClientFailure, ImportItem, ImportRecord, ImportSkippedImage,
} from '../../types';
import type { ImportItemDraft } from '../shopee-import/types';
import { ImportCallError } from './errors';
import { ImportRunner, type ImportApi, type RunnerDeps, type RunnerInput } from './runner';
import type { TransferOutcome } from './images';

// 全部是自編的小資料；不碰網路、不碰真實檔案

const draft = (id: string, opts: {
  extra?: string[]; variantImage?: string | null; variants?: number; cover?: string;
} = {}): ImportItemDraft => ({
  sourceProductId: id, title: `商品${id}`, description: '', categoryId: 'toys', status: 'active',
  images: [
    { slot: 'cover', sourceUrl: opts.cover ?? `src://${id}/cover` },
    ...(opts.extra ?? []).map((u, i) => ({ slot: `image:${i + 1}`, sourceUrl: u })),
  ],
  variants: Array.from({ length: opts.variants ?? 1 }, (_, i) => ({
    sourceVariantId: `${id}0${i}`, name: `規格${i}`, price: 100, stock: 1,
    image: opts.variantImage ? { slot: 'option:款式', sourceUrl: opts.variantImage } : null,
  })),
});

const record = (over: Partial<ImportRecord> = {}): ImportRecord => ({
  importId: 'imp1', status: 'completed', startedAt: 't0', finishedAt: 't1',
  totalProducts: 0, created: 0, updated: 0, failed: 0, skipped: 0, skippedImages: 0, ...over,
});

function setup(drafts: ImportItemDraft[], opts: {
  known?: { sourceUrl: string; url: string }[];
  fail?: Record<string, 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_UPLOAD_FAILED'>;
  batchErrors?: (call: number) => unknown;
  results?: (items: ImportItem[]) => ImportBatchResult[];
  finishError?: () => unknown;
  offline?: () => boolean | Promise<boolean>;
  previewFailures?: ImportClientFailure[];
  batchSize?: number;
} = {}) {
  const log = {
    transfers: [] as string[], batchCalls: [] as ImportItem[][], starts: 0,
    finish: null as null | { failures: ImportClientFailure[]; skipped: ImportSkippedImage[] },
    finishCalls: 0,
  };
  let batchCall = 0;
  const api: ImportApi = {
    async reachable() { return true; },
    async start() { log.starts++; return { importId: 'imp1', startedAt: 't0' }; },
    async batch(_id, items) {
      const err = opts.batchErrors?.(++batchCall);
      if (err) throw err;
      log.batchCalls.push(items);
      return opts.results ? opts.results(items) : items.map((i): ImportBatchResult => ({
        sourceProductId: i.sourceProductId, outcome: 'created', productId: `p-${i.sourceProductId}`,
        status: i.status, errors: [],
      }));
    },
    async finish(_id, failures, skipped) {
      log.finishCalls++;
      const err = opts.finishError?.();
      if (err) throw err;
      log.finish = { failures, skipped };
      return record({ failed: failures.length });
    },
  };
  const deps: RunnerDeps = {
    api,
    transfer: async (url): Promise<TransferOutcome> => {
      log.transfers.push(url);
      const code = opts.fail?.[url];
      return code ? { ok: false, code } : { ok: true, url: `local://${url}` };
    },
    sleep: async () => {},
    isOffline: async () => (opts.offline ? opts.offline() : false),
    coverFailureReason: (c) => `主圖失敗:${c}`,
    backendItemReason: (c, m) => `${c}:${m}`,
    batchSize: opts.batchSize ?? 2,
    imageConcurrency: 2,
  };
  const input: RunnerInput = {
    meta: {
      externalShopId: '1', files: [], totalProducts: drafts.length, skipped: 0,
      options: { skipSoldOut: false, allHidden: false },
    },
    drafts, previewFailures: opts.previewFailures ?? [], knownImages: opts.known ?? [],
  };
  return { runner: new ImportRunner(input, deps), log };
}

describe('ImportRunner', () => {
  it('分批轉存並寫入；統計新增與上下架；結束時送出紀錄', async () => {
    const { runner, log } = setup([draft('1'), draft('2'), draft('3', { extra: ['src://3/a'] })]);
    expect(runner.getSnapshot().images.total).toBe(4);
    await runner.run();
    const snap = runner.getSnapshot();
    expect(snap.phase).toBe('done');
    expect(log.batchCalls.map((b) => b.length)).toEqual([2, 1]);
    expect(snap).toMatchObject({ created: 3, updated: 0, failed: 0 });
    expect(snap.products).toEqual({ done: 3, total: 3 });
    expect(snap.images).toEqual({ done: 4, total: 4 });
    expect(runner.getOutcome()).toMatchObject({ created: 3, active: 3, hidden: 0 });
    // 送出去的圖片網址都是已轉存的好物集網址，原網址保留在 sourceUrl
    expect(log.batchCalls[0][0].images[0]).toEqual({ url: 'local://src://1/cover', sourceUrl: 'src://1/cover' });
  });

  it('同一個網址只轉存一次；index 已有的直接沿用、不計入分母', async () => {
    const shared = 'src://shared';
    const { runner, log } = setup(
      [draft('1', { cover: shared }), draft('2', { cover: shared }), draft('3', { cover: 'src://old' })],
      { known: [{ sourceUrl: 'src://old', url: 'http://local/old.jpg' }] },
    );
    expect(runner.getSnapshot().images.total).toBe(1);
    await runner.run();
    expect(log.transfers).toEqual([shared]);
    expect(log.batchCalls.flat().find((i) => i.sourceProductId === '3')?.images[0].url).toBe('http://local/old.jpg');
  });

  it('全部都可沿用時，圖片分母為 0（重匯同一批）', () => {
    const { runner } = setup([draft('1')], { known: [{ sourceUrl: 'src://1/cover', url: 'http://local/x.jpg' }] });
    expect(runner.getSnapshot().images).toEqual({ done: 0, total: 0 });
  });

  it('主圖失敗：整件不寫入、列為失敗並寫進結束紀錄；其他件照常', async () => {
    const { runner, log } = setup([draft('1'), draft('2')], { fail: { 'src://1/cover': 'IMAGE_DOWNLOAD_FAILED' } });
    await runner.run();
    expect(log.batchCalls.flat().map((i) => i.sourceProductId)).toEqual(['2']);
    expect(runner.getOutcome().failures).toEqual([{ sourceProductId: '1', reason: '主圖失敗:IMAGE_DOWNLOAD_FAILED' }]);
    expect(log.finish?.failures).toEqual([
      { sourceProductId: '1', code: 'IMAGE_DOWNLOAD_FAILED', message: '主圖失敗:IMAGE_DOWNLOAD_FAILED' },
    ]);
    expect(runner.getSnapshot()).toMatchObject({ created: 1, failed: 1 });
    expect(runner.getSnapshot().products).toEqual({ done: 2, total: 2 });
  });

  it('整批都是主圖失敗：不呼叫批次寫入（0 件會被後端拒絕）', async () => {
    const { runner, log } = setup([draft('1')], { fail: { 'src://1/cover': 'IMAGE_UPLOAD_FAILED' } });
    await runner.run();
    expect(log.batchCalls).toEqual([]);
    expect(runner.getSnapshot().phase).toBe('done');
  });

  it('副圖失敗：略過該張、其餘順序不變；規格圖失敗：共用的規格都沒圖，只回報一次', async () => {
    const { runner, log } = setup(
      [draft('1', { extra: ['src://1/a', 'src://1/b', 'src://1/c'], variantImage: 'src://1/opt', variants: 2 })],
      { fail: { 'src://1/b': 'IMAGE_DOWNLOAD_FAILED', 'src://1/opt': 'IMAGE_UPLOAD_FAILED' } },
    );
    await runner.run();
    const sent = log.batchCalls[0][0];
    expect(sent.images.map((i) => i.sourceUrl)).toEqual(['src://1/cover', 'src://1/a', 'src://1/c']);
    expect(sent.variants.map((v) => v.image)).toEqual([null, null]);
    expect(runner.getOutcome().skippedImages).toEqual([
      { sourceProductId: '1', slot: 'image:2', sourceUrl: 'src://1/b', code: 'IMAGE_DOWNLOAD_FAILED' },
      { sourceProductId: '1', slot: 'option:款式', sourceUrl: 'src://1/opt', code: 'IMAGE_UPLOAD_FAILED' },
    ]);
    expect(log.finish?.skipped).toHaveLength(2);
    expect(runner.getSnapshot().failed).toBe(0); // 只有略過圖片，不算失敗（Q-7）
  });

  it('後端回報單件失敗：列入失敗清單（含中文原因），不算新增', async () => {
    const { runner } = setup([draft('1'), draft('2')], {
      results: (items) => items.map((i): ImportBatchResult => i.sourceProductId === '1'
        ? { sourceProductId: '1', outcome: 'failed', productId: null, status: null,
            errors: [{ code: 'TITLE_LENGTH', field: 'title', message: 'm' }] }
        : { sourceProductId: '2', outcome: 'updated', productId: 'p2', status: 'hidden', errors: [] }),
    });
    await runner.run();
    const out = runner.getOutcome();
    expect(out.failures).toEqual([{ sourceProductId: '1', reason: 'TITLE_LENGTH:m' }]);
    expect(out).toMatchObject({ created: 0, updated: 1, hidden: 1, active: 0 });
  });

  it('預覽就有錯的商品：不送出，但列入失敗清單與結束紀錄', async () => {
    const pf = [{ sourceProductId: '9', code: 'TITLE_LENGTH', message: '商品名稱需為 5–60 字，目前 1 字' }];
    const { runner, log } = setup([draft('1')], { previewFailures: pf });
    expect(runner.getSnapshot().failed).toBe(1);
    await runner.run();
    expect(log.finish?.failures).toEqual(pf);
    expect(runner.getOutcome().failures).toEqual([{ sourceProductId: '9', reason: pf[0].message }]);
  });

  it('批次寫入網路失敗：同批重送，第三次成功就不算中斷', async () => {
    const { runner, log } = setup([draft('1')], {
      batchErrors: (n) => (n < 3 ? new ImportCallError('Failed to fetch', null) : null),
    });
    await runner.run();
    expect(runner.getSnapshot().phase).toBe('done');
    expect(log.batchCalls).toHaveLength(1);
  });

  it('重送用完仍失敗 → 中斷；再 run() 從同一批接著做，已轉存的圖片不重傳、先前的批次不重寫', async () => {
    let allow = false;
    const { runner, log } = setup([draft('1'), draft('2'), draft('3'), draft('4')], {
      batchErrors: (n) => (n >= 2 && !allow ? new ImportCallError('Failed to fetch', null) : null),
    });
    await runner.run();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'interrupted', created: 2 });
    expect(runner.getSnapshot().message).toContain('Failed to fetch');
    const transfersBefore = log.transfers.length;
    allow = true;
    await runner.run();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'done', created: 4 });
    expect(log.transfers.length).toBe(transfersBefore + 0);
    expect(log.batchCalls.map((b) => b.map((i) => i.sourceProductId))).toEqual([['1', '2'], ['3', '4']]);
    expect(log.starts).toBe(1);
  });

  it('後端明確拒絕（IMPORT_NOT_FOUND）：不重送、不可重試', async () => {
    let calls = 0;
    const { runner } = setup([draft('1')], {
      batchErrors: () => { calls++; return new ImportCallError('找不到', 'IMPORT_NOT_FOUND'); },
    });
    await runner.run();
    expect(calls).toBe(1);
    expect(runner.getSnapshot()).toMatchObject({ phase: 'fatal', errorCode: 'IMPORT_NOT_FOUND' });
  });

  it('圖片失敗但目前離線：視為中斷，不把圖片記成失敗', async () => {
    let offline = false;
    const { runner } = setup([draft('1')], {
      fail: { 'src://1/cover': 'IMAGE_DOWNLOAD_FAILED' },
      offline: () => offline,
    });
    offline = true;
    await runner.run();
    expect(runner.getSnapshot().phase).toBe('interrupted');
    expect(runner.getOutcome().failures).toEqual([]);
  });

  it('連續上傳失敗達上限：中斷，不是一張張記成失敗', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `src://x/${i}`);
    const fail = Object.fromEntries(urls.map((u) => [u, 'IMAGE_UPLOAD_FAILED' as const]));
    const { runner } = setup([draft('1', { extra: urls })], { fail, batchSize: 5 });
    await runner.run();
    expect(runner.getSnapshot().phase).toBe('interrupted');
    expect(runner.getSnapshot().message).toContain('上傳');
  });

  it('結束紀錄沒存成功：停在 finish-failed，重新儲存後完成；商品統計不變', async () => {
    let fail = true;
    const { runner, log } = setup([draft('1')], {
      finishError: () => (fail ? new ImportCallError('逾時', null) : null),
    });
    await runner.run();
    expect(runner.getSnapshot().phase).toBe('finish-failed');
    expect(log.finishCalls).toBe(3);
    expect(runner.getSnapshot().created).toBe(1);
    fail = false;
    await runner.retryFinish();
    expect(runner.getSnapshot().phase).toBe('done');
    expect(runner.getOutcome().record).not.toBeNull();
  });

  it('「直接看結果」：略過紀錄、沒有 record', async () => {
    const { runner } = setup([draft('1')], { finishError: () => new ImportCallError('逾時', null) });
    await runner.run();
    runner.skipFinish();
    expect(runner.getSnapshot().phase).toBe('done');
    expect(runner.getOutcome().record).toBeNull();
  });

  it('abort：進行中的流程停止，狀態為 aborted，之後 run() 無效', async () => {
    const { runner, log } = setup([draft('1')]);
    runner.abort();
    await runner.run();
    expect(runner.getSnapshot().phase).toBe('aborted');
    expect(log.starts).toBe(0);
  });

  it('訂閱者會在每次進展時被通知', async () => {
    const { runner } = setup([draft('1')]);
    let n = 0;
    runner.subscribe(() => { n++; });
    await runner.run();
    expect(n).toBeGreaterThan(3);
  });
});
