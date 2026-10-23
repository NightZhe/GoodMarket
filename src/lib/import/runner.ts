import type {
  ImageRef, ImportBatchReport, ImportBatchResult, ImportClientFailure, ImportItem, ImportRecord,
  ImportSkippedImage, ImportStartMeta,
} from '../../types';
import type { ImportItemDraft } from '../shopee-import/types';
import { ImportCallError } from './errors';
import { runPool, type ImageFailureCode, type TransferOutcome } from './images';

// 匯入執行器：分批「先轉存這批的圖片 → 再呼叫一次批次寫入」（F-3.1）。
// 全部狀態都在這個物件裡，中斷（網路、逾時）後呼叫 run() 會從沒做完的那一批接著做；
// 已轉存的圖片留在快取，不會重傳。關掉分頁的中斷則是靠斷點續傳：再放入同一批檔案，
// 預覽頁會用 `resume` 帶著同一個 importId 建立新的執行器，只處理沒做完的商品（見 resume.ts）。
// 每批寫入同時帶上這一批的回報（主圖失敗、略過的圖片），所以關掉分頁也不會丟掉失敗清單。

export const BATCH_SIZE = 20;
export const IMAGE_CONCURRENCY = 6;
export const CALL_ATTEMPTS = 3;
/** 連續這麼多張「上傳」失敗，視為好物集端出問題（不是圖片本身壞），停下來讓賣家重試 */
export const UPLOAD_FAILURE_STREAK_LIMIT = 10;

export interface ImportApi {
  start(meta: ImportStartMeta, signal: AbortSignal): Promise<{ importId: string; startedAt: string }>;
  /** report 由後端以 sourceProductId／(sourceProductId, slot) 去重合併，所以重送同一批是安全的 */
  batch(importId: string, items: ImportItem[], report: ImportBatchReport, signal: AbortSignal): Promise<ImportBatchResult[]>;
  /** 連得到好物集的後端嗎（任何 HTTP 回應都算連得到） */
  reachable(): Promise<boolean>;
  finish(
    importId: string, failures: ImportClientFailure[], skippedImages: ImportSkippedImage[], signal: AbortSignal,
  ): Promise<ImportRecord>;
}

export interface RunnerDeps {
  api: ImportApi;
  transfer: (sourceUrl: string, signal: AbortSignal) => Promise<TransferOutcome>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * 目前連不上網路／好物集嗎？圖片重試用完仍失敗時才會問。
   * 是的話，這張圖的失敗不算數，改成中斷（F-3.6）——否則斷網一下，整批商品都會被記成「主圖失敗」。
   * 只看 navigator.onLine 不夠（連著 Wi-Fi 但沒有網路時它仍是 true），所以實作端還要真的連一次後端。
   */
  isOffline: () => Promise<boolean>;
  coverFailureReason: (code: ImageFailureCode) => string;
  backendItemReason: (code: string, message: string) => string;
  batchSize?: number;
  imageConcurrency?: number;
  now?: () => number;
}

export interface RunnerInput {
  meta: ImportStartMeta;
  drafts: ImportItemDraft[];
  /** 預覽就判定有錯、不會送出的商品（已含原因）；結束時一併回報，也列入失敗清單 */
  previewFailures: ImportClientFailure[];
  /** get_import_index.images：本店已轉存過的圖片，直接沿用 */
  knownImages: readonly { sourceUrl: string; url: string }[];
  /** 接續上次沒做完的匯入：跳過 start，直接寫進這筆紀錄。priorDone＝上次已完成的件數（只給畫面顯示） */
  resume?: { importId: string; priorDone?: number };
}

export type RunnerPhase =
  | 'preparing' | 'running' | 'finishing'
  | 'interrupted' | 'fatal' | 'finish-failed' | 'done' | 'aborted';

export interface RunnerSnapshot {
  phase: RunnerPhase;
  /** 續傳時上次已完成的件數（不含在 products 內）；非續傳為 0 */
  priorDone: number;
  images: { done: number; total: number };
  products: { done: number; total: number };
  batch: { current: number; total: number };
  created: number;
  updated: number;
  failed: number;
  skippedImages: number;
  /** interrupted／fatal／finish-failed 時的說明 */
  message: string | null;
  /** fatal 時的後端錯誤碼 */
  errorCode: ImportCallError['code'];
  /** 最近一次有進展（圖片完成、批次寫入）的時間，給「30 秒沒進度」提示用 */
  lastProgressAt: number;
}

export interface FailedProduct {
  sourceProductId: string;
  reason: string;
}

export interface RunnerOutcome {
  created: number;
  updated: number;
  active: number;
  hidden: number;
  failures: FailedProduct[];
  skippedImages: ImportSkippedImage[];
  record: ImportRecord | null;
}

/** 偵測到斷網時的說明（畫面的主要說明已經是這句，不重複顯示） */
export const OFFLINE_MESSAGE = '網路連線有問題，匯入停住了';

class Interrupted extends Error {}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export class ImportRunner {
  private readonly deps: RunnerDeps;
  private readonly input: RunnerInput;
  private readonly batches: ImportItemDraft[][];
  private readonly ctl = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly resolved = new Map<string, TransferOutcome>();

  private importId: string | null = null;
  private nextBatch = 0;
  private running = false;
  private uploadFailureStreak = 0;

  private active = 0;
  private hidden = 0;
  private readonly failures: FailedProduct[] = [];
  private readonly clientFailures: ImportClientFailure[];
  private readonly skippedImages: ImportSkippedImage[] = [];
  /** 還沒成功送到後端的回報（預覽錯誤、沒有呼叫寫入的批次留下的失敗）；下一次批次寫入成功後清空 */
  private unsentFailures: ImportClientFailure[];
  private unsentSkipped: ImportSkippedImage[] = [];
  private record: ImportRecord | null = null;

  private snap: RunnerSnapshot;

  constructor(input: RunnerInput, deps: RunnerDeps) {
    this.input = input;
    this.deps = deps;
    const size = deps.batchSize ?? BATCH_SIZE;
    this.batches = [];
    for (let i = 0; i < input.drafts.length; i += size) this.batches.push(input.drafts.slice(i, i + size));

    this.clientFailures = [...input.previewFailures];
    this.unsentFailures = [...input.previewFailures];
    this.importId = input.resume?.importId ?? null;
    for (const f of input.previewFailures) this.failures.push({ sourceProductId: f.sourceProductId, reason: f.message });
    for (const k of input.knownImages) this.resolved.set(k.sourceUrl, { ok: true, url: k.url });

    this.snap = {
      phase: 'preparing',
      priorDone: input.resume?.priorDone ?? 0,
      images: { done: 0, total: 0 },
      products: { done: 0, total: input.drafts.length },
      batch: { current: 0, total: this.batches.length },
      created: 0, updated: 0, failed: input.previewFailures.length, skippedImages: 0,
      message: null, errorCode: null, lastProgressAt: this.now(),
    };
    this.snap.images.total = this.pendingUrls(input.drafts).length;
  }

  // ───── 給畫面訂閱（useSyncExternalStore）─────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): RunnerSnapshot => this.snap;

  getOutcome(): RunnerOutcome {
    return {
      created: this.snap.created, updated: this.snap.updated,
      active: this.active, hidden: this.hidden,
      failures: [...this.failures],
      skippedImages: [...this.skippedImages],
      record: this.record,
    };
  }

  /** 離開頁面：停掉所有進行中的請求；已寫入的商品會保留 */
  abort(): void {
    this.ctl.abort();
    this.update({ phase: 'aborted' });
  }

  // ───── 流程 ─────

  /** 開始，或從中斷處接著做。重複呼叫（已在跑）會被忽略 */
  async run(): Promise<void> {
    if (this.running || this.ctl.signal.aborted) return;
    this.running = true;
    const signal = this.ctl.signal;
    try {
      if (this.importId === null) {
        this.update({ phase: 'preparing', message: null, errorCode: null, progress: true });
        const started = await this.callWithRetry(() => this.deps.api.start(this.input.meta, signal));
        this.importId = started.importId;
      }
      this.update({ phase: 'running', message: null, errorCode: null });
      while (this.nextBatch < this.batches.length) {
        this.update({ batch: { current: this.nextBatch + 1, total: this.batches.length } });
        await this.processBatch(this.batches[this.nextBatch], signal);
        this.nextBatch++;
      }
      await this.finish(signal);
    } catch (e) {
      this.handleFailure(e);
    } finally {
      this.running = false;
    }
  }

  /** 商品都寫完、但匯入紀錄沒存成功時，重新儲存紀錄 */
  async retryFinish(): Promise<void> {
    if (this.running || this.importId === null || this.ctl.signal.aborted) return;
    this.running = true;
    try {
      await this.finish(this.ctl.signal);
    } catch (e) {
      this.handleFailure(e);
    } finally {
      this.running = false;
    }
  }

  /** 放棄儲存紀錄、直接看結果（紀錄會留在「未完成」，下次進精靈會看到） */
  skipFinish(): void {
    if (this.snap.phase === 'finish-failed') this.update({ phase: 'done' });
  }

  private async finish(signal: AbortSignal): Promise<void> {
    this.update({ phase: 'finishing', message: null, errorCode: null });
    const importId = this.importId;
    if (importId === null) throw new Error('尚未開始匯入就要結束');
    try {
      this.record = await this.callWithRetry(
        () => this.deps.api.finish(importId, this.clientFailures, this.skippedImages, signal),
      );
    } catch (e) {
      // 上一次呼叫其實成功、只是回應遺失：紀錄已經結束，只是拿不到內容
      if (e instanceof ImportCallError && e.code === 'IMPORT_CLOSED') this.record = null;
      else throw new FinishFailed(e instanceof Error ? e.message : String(e));
    }
    this.update({ phase: 'done' });
  }

  private handleFailure(e: unknown): void {
    if (isAbort(e)) { this.update({ phase: 'aborted' }); return; }
    if (e instanceof FinishFailed) { this.update({ phase: 'finish-failed', message: e.message }); return; }
    if (e instanceof Interrupted) { this.update({ phase: 'interrupted', message: e.message }); return; }
    if (e instanceof ImportCallError) {
      this.update(e.code === null
        ? { phase: 'interrupted', message: e.message }
        : { phase: 'fatal', message: e.message, errorCode: e.code });
      return;
    }
    // 沒預期到的錯誤（程式 bug）：不能假裝是網路問題，原樣丟出讓它被看見
    this.update({ phase: 'fatal', message: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  // ───── 一批 ─────

  private pendingUrls(items: readonly ImportItemDraft[]): string[] {
    const urls = new Set<string>();
    for (const it of items) {
      for (const img of it.images) urls.add(img.sourceUrl);
      for (const v of it.variants) if (v.image) urls.add(v.image.sourceUrl);
    }
    return [...urls].filter((u) => !this.resolved.has(u));
  }

  private async transferBatchImages(items: readonly ImportItemDraft[], signal: AbortSignal): Promise<void> {
    const urls = this.pendingUrls(items);
    await runPool(urls, this.deps.imageConcurrency ?? IMAGE_CONCURRENCY, async (url) => {
      const out = await this.deps.transfer(url, signal);
      if (!out.ok && await this.checkOffline()) throw new Interrupted(OFFLINE_MESSAGE);
      if (out.ok) {
        this.uploadFailureStreak = 0;
      } else if (out.code === 'IMAGE_UPLOAD_FAILED') {
        this.uploadFailureStreak++;
        if (this.uploadFailureStreak >= UPLOAD_FAILURE_STREAK_LIMIT) {
          throw new Interrupted('圖片連續上傳失敗，好物集可能暫時有問題，請稍後再試');
        }
      } else {
        this.uploadFailureStreak = 0;
      }
      this.resolved.set(url, out);
      this.update({ images: { done: this.snap.images.done + 1, total: this.snap.images.total }, progress: true });
    });
  }

  private async processBatch(batch: readonly ImportItemDraft[], signal: AbortSignal): Promise<void> {
    await this.transferBatchImages(batch, signal);

    const sendable: ImportItem[] = [];
    const coverFailures: { id: string; failure: ImportClientFailure }[] = [];
    const skippedByItem = new Map<string, ImportSkippedImage[]>();

    for (const draft of batch) {
      const skipped: ImportSkippedImage[] = [];
      const skippedKeys = new Set<string>();
      const skip = (slot: string, sourceUrl: string, code: ImageFailureCode) => {
        if (skippedKeys.has(slot)) return; // 共用同一張選項圖的規格只回報一次
        skippedKeys.add(slot);
        skipped.push({ sourceProductId: draft.sourceProductId, slot, sourceUrl, code });
      };

      const images: ImageRef[] = [];
      let coverFailure: ImageFailureCode | null = null;
      for (const img of draft.images) {
        const out = this.resolved.get(img.sourceUrl);
        if (!out) throw new Error(`圖片 ${img.sourceUrl} 沒有轉存結果`);
        if (out.ok) images.push({ url: out.url, sourceUrl: img.sourceUrl });
        else if (img.slot === 'cover') coverFailure = out.code;
        else skip(img.slot, img.sourceUrl, out.code);
      }
      if (coverFailure !== null) {
        coverFailures.push({
          id: draft.sourceProductId,
          failure: {
            sourceProductId: draft.sourceProductId,
            code: coverFailure,
            message: this.deps.coverFailureReason(coverFailure),
          },
        });
        continue;
      }

      const variants = draft.variants.map((v) => {
        let image: ImageRef | null = null;
        if (v.image) {
          const out = this.resolved.get(v.image.sourceUrl);
          if (!out) throw new Error(`圖片 ${v.image.sourceUrl} 沒有轉存結果`);
          if (out.ok) image = { url: out.url, sourceUrl: v.image.sourceUrl };
          else skip(v.image.slot, v.image.sourceUrl, out.code);
        }
        return { sourceVariantId: v.sourceVariantId, name: v.name, price: v.price, stock: v.stock, image };
      });

      skippedByItem.set(draft.sourceProductId, skipped);
      sendable.push({
        sourceProductId: draft.sourceProductId, title: draft.title, description: draft.description,
        categoryId: draft.categoryId, status: draft.status, images, variants,
      });
    }

    // 這一批新產生的回報（冪等：同一批重做會得到同樣的內容）
    const batchFailures = coverFailures.map((c) => c.failure);
    const batchSkipped = [...skippedByItem.values()].flat();

    let results: ImportBatchResult[] = [];
    if (sendable.length > 0) {
      const importId = this.importId;
      if (importId === null) throw new Error('尚未開始匯入就要寫入');
      const report: ImportBatchReport = {
        clientFailures: [...this.unsentFailures, ...batchFailures],
        skippedImages: [...this.unsentSkipped, ...batchSkipped],
      };
      results = await this.callWithRetry(() => this.deps.api.batch(importId, sendable, report, signal));
      if (results.length !== sendable.length) {
        throw new Error(`批次寫入回傳 ${results.length} 筆，預期 ${sendable.length} 筆`);
      }
      this.unsentFailures = [];
      this.unsentSkipped = [];
    } else {
      // 整批都是主圖失敗、沒有東西可寫：回報順延到下一次寫入（最晚由 finish 補上）
      this.unsentFailures.push(...batchFailures);
      this.unsentSkipped.push(...batchSkipped);
    }

    // 這批寫入成功（或沒有可寫的）才統計，重送不會重複計數
    for (const c of coverFailures) {
      this.clientFailures.push(c.failure);
      this.failures.push({ sourceProductId: c.id, reason: c.failure.message });
    }
    let created = 0;
    let updated = 0;
    let failed = coverFailures.length;
    for (const r of results) {
      if (r.outcome === 'failed') {
        failed++;
        this.failures.push({
          sourceProductId: r.sourceProductId,
          reason: r.errors.map((er) => this.deps.backendItemReason(er.code, er.message)).join('；') || '系統錯誤',
        });
        continue;
      }
      if (r.outcome === 'created') created++;
      else updated++;
      if (r.status === 'active') this.active++;
      else if (r.status === 'hidden') this.hidden++;
      this.skippedImages.push(...(skippedByItem.get(r.sourceProductId) ?? []));
    }
    this.update({
      products: { done: this.snap.products.done + batch.length, total: this.snap.products.total },
      created: this.snap.created + created,
      updated: this.snap.updated + updated,
      failed: this.snap.failed + failed,
      skippedImages: this.skippedImages.length,
      progress: true,
    });
  }

  /** 呼叫層重送最多 3 次（寫入是冪等的）；後端明確拒絕（有錯誤碼）不重送；用完次數就是「中斷」 */
  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const signal = this.ctl.signal;
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (signal.aborted) throw e;
        if (!(e instanceof ImportCallError) || !e.retryable) throw e;
        if (attempt >= CALL_ATTEMPTS) throw e;
        await this.deps.sleep(800 * attempt, signal);
      }
    }
  }

  /** 多張圖同時失敗時，兩秒內共用同一次檢查結果 */
  private offlineCheck: { at: number; result: Promise<boolean> } | null = null;

  private checkOffline(): Promise<boolean> {
    const t = this.now();
    if (!this.offlineCheck || t - this.offlineCheck.at > 2000) {
      this.offlineCheck = { at: t, result: this.deps.isOffline() };
    }
    return this.offlineCheck.result;
  }

  // ───── 狀態 ─────

  private now = () => (this.deps.now ?? Date.now)();

  private update(patch: Partial<RunnerSnapshot> & { progress?: boolean }): void {
    const { progress, ...rest } = patch;
    this.snap = { ...this.snap, ...rest, lastProgressAt: progress ? this.now() : this.snap.lastProgressAt };
    for (const l of this.listeners) l();
  }
}

class FinishFailed extends Error {}
