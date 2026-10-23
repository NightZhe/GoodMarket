import { describe, expect, it } from 'vitest';
import type { ImportRecord } from '../../types';
import { matchResume } from './resume';

const analysis = (over: { shop?: string; basic?: string; sales?: string; media?: string } = {}) => ({
  externalShopId: over.shop ?? '1234567',
  sheets: {
    basic: { fileName: over.basic ?? 'Mass_Update_basic_info.xlsx' },
    sales: { fileName: over.sales ?? 'Mass_Update_sales_info.xlsx' },
    media: { fileName: over.media ?? 'Mass_Update_media_info.xlsx' },
  },
});

const running = (over: Partial<ImportRecord> = {}): ImportRecord => ({
  importId: 'imp-1', status: 'running', startedAt: '2026-10-23T01:00:00Z', finishedAt: null,
  totalProducts: 100, created: 30, updated: 10, failed: 1, skipped: 0, skippedImages: 0,
  externalShopId: '1234567',
  // 檔案順序故意和 basic／sales／media 不同：比對依 kind，不依順序
  files: [
    { kind: 'media_info', fileName: 'Mass_Update_media_info.xlsx' },
    { kind: 'basic_info', fileName: 'Mass_Update_basic_info.xlsx' },
    { kind: 'sales_info', fileName: 'Mass_Update_sales_info.xlsx' },
  ],
  options: { skipSoldOut: true, allHidden: false },
  categoryOverrides: { '5': 'toys' },
  progress: {
    items: [
      { sourceProductId: '1', outcome: 'created' },
      { sourceProductId: '2', outcome: 'updated' },
      { sourceProductId: '3', outcome: 'failed' },
    ],
    clientFailures: [], skippedImages: [],
  },
  ...over,
});

describe('matchResume', () => {
  it('命中：未完成、同店家、三個檔名依 kind 完全相同 → 回紀錄與 created／updated 的 id（failed 不算做完）', () => {
    const rec = running();
    const hit = matchResume(rec, analysis());
    expect(hit?.record).toBe(rec);
    expect([...(hit?.doneIds ?? [])].sort()).toEqual(['1', '2']);
  });

  it('命中時 remaining ＝ 總件數 − 已完成件數', () => {
    expect(matchResume(running(), analysis())?.remaining).toBe(98);
    expect(matchResume(running({ totalProducts: 2 }), analysis())?.remaining).toBe(0);
  });

  it('檔名不同（可能是重新匯出的新檔）→ 不命中，任何一個 kind 不同都算', () => {
    expect(matchResume(running(), analysis({ basic: 'new_basic.xlsx' }))).toBeNull();
    expect(matchResume(running(), analysis({ sales: 'new_sales.xlsx' }))).toBeNull();
    expect(matchResume(running(), analysis({ media: 'new_media.xlsx' }))).toBeNull();
  });

  it('同樣的三個檔名但對調 kind → 不命中', () => {
    expect(matchResume(running(), analysis({
      basic: 'Mass_Update_sales_info.xlsx', sales: 'Mass_Update_basic_info.xlsx',
    }))).toBeNull();
  });

  it('店家不同 → 不命中', () => {
    expect(matchResume(running(), analysis({ shop: '7654321' }))).toBeNull();
  });

  it('上次已完成（completed）→ 不命中，即使檔名與店家都相同', () => {
    expect(matchResume(running({ status: 'completed', finishedAt: 't1', progress: null }), analysis())).toBeNull();
  });

  it('沒有上次紀錄 → 不命中', () => {
    expect(matchResume(null, analysis())).toBeNull();
  });

  it('紀錄缺檔名（不完整）→ 不命中', () => {
    expect(matchResume(running({ files: [{ kind: 'basic_info', fileName: 'Mass_Update_basic_info.xlsx' }] }), analysis())).toBeNull();
  });

  it('running 但沒有 progress：仍可接續（同一筆紀錄），已完成清單為空', () => {
    const hit = matchResume(running({ progress: null }), analysis());
    expect(hit?.doneIds.size).toBe(0);
    expect(hit?.remaining).toBe(100);
  });
});
