import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import Banner from '../../../components/import/Banner';
import KPI, { type KpiKind } from '../../../components/import/KPI';
import PreviewRow, { PreviewHeader } from '../../../components/import/PreviewRow';
import Switch from '../../../components/import/Switch';
import { btnOutline, btnPrimaryLg } from '../../../components/import/ui';
import { ALL_KINDS } from '../../../lib/shopee-import/constants';
import type { ShopeeImportLib } from '../../../lib/import/loader';
import { matchResume } from '../../../lib/import/resume';
import type { ParsedProduct, PreviewOptions, PreviewRow as Row } from '../../../lib/shopee-import/types';
import type { CategoryId, ImportIndex } from '../../../types';
import { useStore } from '../../../store/StoreContext';
import { fmtDateTime, n, useFocusOnMount, type ReadyAnalysis, type StartPayload } from './shared';

const PAGE_SIZE = 50;
const RESUME_LOCK_NOTE = '接續上次匯入時沿用上次的設定';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; index: ImportIndex; products: ParsedProduct[] };

interface Props {
  lib: ShopeeImportLib;
  analysis: ReadyAnalysis;
  announce: (text: string) => void;
  onBack: () => void;
  onStart: (payload: StartPayload) => void;
}

const FILTER_MATCH: Record<KpiKind, (r: Row) => boolean> = {
  new: (r) => r.action === 'create',
  update: (r) => r.action === 'update',
  error: (r) => r.action === 'error',
  warn: (r) => (r.action === 'create' || r.action === 'update') && r.warnings.length > 0,
  skip: (r) => r.action === 'skip',
  done: (r) => r.action === 'done',
};

/** 錯誤排最前、提醒其次，其餘照檔案順序（Array.sort 是穩定排序） */
const rank = (r: Row) => (r.action === 'error' ? 0 : FILTER_MATCH.warn(r) ? 1 : 2);

export default function StepPreview({ lib, analysis, announce, onBack, onStart }: Props) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const { getImportIndex } = useStore();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [options, setOptions] = useState<PreviewOptions>({ skipSoldOut: false, allHidden: false });
  const [edited, setEdited] = useState<Record<string, CategoryId>>({});
  const [leftResume, setLeftResume] = useState(false);
  const [filter, setFilter] = useState<KpiKind | null>(null);
  const [page, setPage] = useState(0);

  const fetchIndex = useCallback(async (signal: AbortSignal) => {
    setLoad({ state: 'loading' });
    try {
      const index = await getImportIndex(signal);
      if (signal.aborted) return;
      const products = lib.convertSheets(analysis.sheets);
      setLoad({ state: 'ready', index, products });
    } catch (e) {
      if (signal.aborted) return;
      setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [getImportIndex, lib, analysis]);

  useEffect(() => {
    const ctl = new AbortController();
    void fetchIndex(ctl.signal);
    return () => ctl.abort();
  }, [fetchIndex]);

  const loaded = load.state === 'ready' ? load : null;
  // 接續上次沒做完的匯入：用剛讀到的最新紀錄再判定一次（步驟 1 看到的可能已經過時）
  const match = useMemo(
    () => (loaded ? matchResume(loaded.index.lastImport, analysis) : null),
    [loaded, analysis],
  );
  const resume = leftResume ? null : match;
  // 上次改過的分類預填（仍可再改）；退出接續模式後也保留，因為那是賣家自己選的
  const overrides = useMemo(() => ({ ...match?.record.categoryOverrides, ...edited }), [match, edited]);
  const effectiveOptions = resume ? resume.record.options : options;
  const preview = useMemo(
    () => (loaded ? lib.buildPreview(loaded.products, loaded.index, effectiveOptions, overrides, resume?.doneIds) : null),
    [lib, loaded, effectiveOptions, overrides, resume],
  );
  const existingStatus = useMemo(
    () => new Map(loaded?.index.products.map((p) => [p.sourceProductId, p.status]) ?? []),
    [loaded],
  );

  const visible = useMemo(() => {
    if (!preview) return [];
    const rows = filter ? preview.rows.filter(FILTER_MATCH[filter]) : preview.rows;
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [preview, filter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const counts = preview?.counts ?? null;
  const importable = counts ? counts.created + counts.updated : 0;
  // 接續時，上次其實已經全部寫完（只差結束紀錄）也要能按下去，把這筆紀錄收尾
  const canRun = importable > 0 || (resume !== null && counts !== null && counts.done > 0);

  // 開關與分類變動後，計數即時重算並朗讀
  useEffect(() => {
    if (!counts) return;
    announce(`${counts.done > 0 ? `上次已完成 ${counts.done}、` : ''}新增 ${counts.created}、更新 ${counts.updated}、錯誤 ${counts.errors}、略過 ${counts.skipped}、需要注意 ${counts.warnings}`);
  }, [counts, announce]);

  const toggleFilter = (k: KpiKind) => { setFilter((f) => (f === k ? null : k)); setPage(0); };

  const leaveResume = () => {
    if (!match) return;
    setOptions(match.record.options); // 解鎖後開關停在上次的設定，不要突然跳掉
    setLeftResume(true);
    setFilter(null);
    setPage(0);
    announce('已改為新的匯入，上次完成的商品會當作更新');
  };

  const start = () => {
    if (!loaded || !preview || !canRun) return;
    const drafts = lib.buildImportItemDrafts(loaded.products, preview);
    const previewFailures = preview.rows.filter((r) => r.action === 'error').map((r) => ({
      sourceProductId: r.sourceProductId,
      code: r.errors[0]?.code ?? 'UNKNOWN',
      message: r.errors.map((e) => e.message).join('；'),
    }));
    const sheets = analysis.sheets;
    const fileName = { basic_info: sheets.basic.fileName, sales_info: sheets.sales.fileName, media_info: sheets.media.fileName };
    // 只帶會送出的商品的分類修改（create／update），續傳時由紀錄還原
    const categoryOverrides = Object.fromEntries(
      preview.rows.filter((r) => (r.action === 'create' || r.action === 'update') && r.sourceProductId in overrides)
        .map((r) => [r.sourceProductId, overrides[r.sourceProductId]]),
    );
    onStart({
      meta: {
        externalShopId: analysis.externalShopId,
        files: ALL_KINDS.map((kind) => ({ kind, fileName: fileName[kind] })),
        totalProducts: preview.counts.created + preview.counts.updated,
        skipped: preview.counts.skipped,
        options: effectiveOptions,
        ...(resume ? {} : { categoryOverrides }),
      },
      drafts, previewFailures, knownImages: loaded.index.images,
      titles: Object.fromEntries(loaded.products.map((p) => [p.sourceProductId, p.title])),
      preview,
      ...(resume ? { resume: { importId: resume.record.importId, priorDone: resume.doneIds.size } } : {}),
    });
  };

  const heading = (
    <h2 id="step2-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">確認要匯入的商品</h2>
  );

  // ── 載入中／讀取失敗 ──（標題用同一個元素，載入完成後焦點才不會掉）
  if (load.state !== 'ready' || !preview || !counts) {
    return (
      <section aria-labelledby="step2-title" className="space-y-4 pb-24 md:pb-20">
        <div>{heading}</div>
        {load.state === 'error' ? (
          <Banner
            kind="error" title="無法確認好物集裡已有哪些商品"
            actions={(
              <>
                <button type="button" className={btnPrimaryLg} onClick={() => { const c = new AbortController(); void fetchIndex(c.signal); }}>重試</button>
                <button type="button" className={btnOutline} onClick={onBack}>回上一步</button>
              </>
            )}
          >
            網路好像有問題，所以還不能預覽（需要知道哪些商品已經匯入過，才能分辨「新增」和「更新」）。
            <span className="mt-1 block text-xs text-muted">{load.message}</span>
          </Banner>
        ) : (
          <div role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />
            正在整理預覽…
          </div>
        )}
      </section>
    );
  }

  const noneToImport = !canRun;
  const onlyFinishRecord = resume !== null && importable === 0 && canRun;
  const kpis: { kind: KpiKind; label: string; sub?: string; value: number }[] = [
    ...(resume ? [{ kind: 'done' as const, label: '上次已完成', sub: '不會再處理', value: counts.done }] : []),
    { kind: 'new', label: '將新增', value: counts.created },
    { kind: 'update', label: '將更新', value: counts.updated },
    { kind: 'error', label: '錯誤', value: counts.errors },
    { kind: 'warn', label: '需要注意', sub: '仍會匯入', value: counts.warnings },
    { kind: 'skip', label: '略過', value: counts.skipped },
  ];
  const filterLabel = filter ? kpis.find((k) => k.kind === filter)?.label : null;

  return (
    <section aria-labelledby="step2-title" className="space-y-4 pb-24 md:pb-20">
      <div>
        {heading}
        <p className="mt-1 text-sm text-muted">
          檔案共 {n(counts.total)} 件商品。確認沒問題再按「{resume ? '接續匯入' : '開始匯入'}」。
        </p>
      </div>

      {resume && (
        <Banner kind="info" title="接續上次的匯入" role="none">
          {fmtDateTime(resume.record.startedAt)} 開始的匯入已完成 {n(counts.done)} 件，這次只處理剩下的商品，寫進同一筆匯入紀錄。開關沿用上次的設定。
        </Banner>
      )}

      <div className={`grid grid-cols-2 gap-2 ${resume ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
        {kpis.map((k) => (
          <KPI key={k.kind} kind={k.kind} label={k.label} sub={k.sub} value={k.value} selected={filter === k.kind} onClick={() => toggleFilter(k.kind)} />
        ))}
      </div>
      <p className="text-xs text-muted">
        {resume && `上次已完成 ${n(counts.done)}＋`}新增 {n(counts.created)}＋更新 {n(counts.updated)}＋錯誤 {n(counts.errors)}＋略過 {n(counts.skipped)}＝檔案共 {n(counts.total)} 件商品
      </p>

      <div className="grid gap-2 md:grid-cols-2">
        <Switch
          title="略過已售完的商品" checked={effectiveOptions.skipSoldOut} disabled={resume !== null}
          description="所有規格庫存都是 0 的新商品不匯入。已經在好物集的商品不受影響，照常更新。"
          note={resume ? RESUME_LOCK_NOTE : undefined}
          onChange={(v) => setOptions((o) => ({ ...o, skipSoldOut: v }))}
        />
        <Switch
          title="全部先下架" checked={effectiveOptions.allHidden} disabled={resume !== null}
          description="新匯入的商品先下架，確認好再自己上架。已經在好物集的商品維持原本的上下架設定。"
          note={resume ? RESUME_LOCK_NOTE : undefined}
          onChange={(v) => setOptions((o) => ({ ...o, allHidden: v }))}
        />
      </div>

      {counts.updated > 0 && (
        <Banner kind="info" title={`${n(counts.updated)} 件商品已經在好物集，會更新`}>
          只更新描述、商品圖、規格（名稱、價格、庫存、規格圖）。商品名稱、分類、免運、原價等你在好物集改過的設定不會動。庫存全部變成 0 的商品會自動下架。
        </Banner>
      )}
      {counts.errors > 0 && (
        <Banner kind="error" title={`${n(counts.errors)} 件有錯誤，不會匯入`} role="none">
          {importable > 0 ? `其他 ${n(importable)} 件照常匯入。` : ''}錯誤原因寫在每件商品下方；匯入完成後可以下載失敗原因檔，修正後再匯入。
        </Banner>
      )}
      {onlyFinishRecord && (
        <Banner kind="info" title="剩下的商品都不需要再處理" role="none">
          上次的商品都已經寫入，只差把這筆匯入紀錄收尾。按「完成這筆匯入」就會結束它。
        </Banner>
      )}
      {noneToImport && (
        <Banner kind="error" title="沒有可以匯入的商品">
          {counts.errors > 0
            ? '每一件都有錯誤，所以不能開始匯入。回到上一步換檔案，或先在蝦皮修正後重新匯出。'
            : '目前的設定下沒有任何商品會被匯入。請關掉「略過已售完」，或回到上一步換檔案。'}
        </Banner>
      )}

      {filter && (
        <p className="text-sm">
          目前只看：{filterLabel}
          <button type="button" className="ml-2 min-h-11 px-2 text-brand underline" onClick={() => { setFilter(null); setPage(0); }}>顯示全部</button>
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <PreviewHeader />
        {visible.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted">
            <p>沒有符合的商品</p>
            <p className="mt-1">目前篩選的類別沒有商品。</p>
            <button type="button" className={`${btnOutline} mt-3`} onClick={() => { setFilter(null); setPage(0); }}>顯示全部</button>
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label="要匯入的商品">
            {pageRows.map((r) => (
              <PreviewRow
                key={r.sourceProductId} row={r} existingStatus={existingStatus.get(r.sourceProductId)}
                onCategory={(id, cat) => setEdited((o) => ({ ...o, [id]: cat }))}
              />
            ))}
          </ul>
        )}
      </div>

      {visible.length > 0 && (
        <nav aria-label="預覽分頁" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted">
            第 {n(current * PAGE_SIZE + 1)}–{n(Math.min((current + 1) * PAGE_SIZE, visible.length))} 件，共 {n(visible.length)} 件（錯誤與提醒排在最前面）
          </p>
          <div className="flex gap-2">
            <button type="button" className={btnOutline} disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />上一頁
            </button>
            <button type="button" className={btnOutline} disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
              下一頁<ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}

      <div className="fixed inset-x-0 bottom-[calc(3.625rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white px-3 py-3 shadow-bar-top md:sticky md:inset-x-auto md:bottom-0 md:rounded-lg md:border md:px-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {noneToImport ? (
              <p className="font-medium">沒有可以匯入的商品</p>
            ) : onlyFinishRecord ? (
              <p className="font-medium">上次的商品都已寫入，只差收尾</p>
            ) : (
              <>
                <p className="font-medium">{resume ? '將接續匯入' : '將匯入'} {n(importable)} 件</p>
                <p className="text-xs text-muted">
                  {resume && `上次已完成 ${n(counts.done)} 件・`}新增 {n(counts.created)}、更新 {n(counts.updated)}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {resume && (
              <button type="button" className="min-h-11 px-2 text-sm text-brand underline" onClick={leaveResume}>
                不接續，當作新的匯入
              </button>
            )}
            <button type="button" className={btnOutline} onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" />上一步
            </button>
            <button
              type="button" aria-disabled={noneToImport} className={btnPrimaryLg}
              onClick={() => { if (!noneToImport) start(); }}
            >
              {onlyFinishRecord ? '完成這筆匯入' : resume ? `接續匯入 ${n(importable)} 件` : `開始匯入 ${n(importable)} 件`}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
