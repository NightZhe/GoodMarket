import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { CircleCheck } from 'lucide-react';
import Banner from '../../../components/import/Banner';
import Dropzone from '../../../components/import/Dropzone';
import FileRow from '../../../components/import/FileRow';
import { btnPrimary } from '../../../components/import/ui';
import { ALL_KINDS, KIND_LABEL, MAX_FILE_BYTES } from '../../../lib/shopee-import/constants';
import type { ShopeeImportLib } from '../../../lib/import/loader';
import { matchResume } from '../../../lib/import/resume';
import type { FileIntake, FileSetIssue, ParsedSheet } from '../../../lib/shopee-import/types';
import type { ImportFileKind, ImportRecord } from '../../../types';
import { fmtDateTime, n, useFocusOnMount, type Entry, type ReadyAnalysis } from './shared';

export type LastImport = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; record: ImportRecord | null };

interface Props {
  lib: ShopeeImportLib | null;
  ensureLib: () => Promise<ShopeeImportLib>;
  entries: Entry[];
  setEntries: Dispatch<SetStateAction<Entry[]>>;
  lastImport: LastImport;
  announce: (text: string) => void;
  /** 從別的步驟回來時才把焦點移到標題；剛進頁面時不搶焦點 */
  focusHeading: boolean;
  onNext: (analysis: ReadyAnalysis) => void;
}

let seq = 0;
const nextId = () => `f${++seq}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

function LastImportInfo({ info }: { info: LastImport }) {
  if (info.state === 'loading') return null;
  if (info.state === 'unavailable') {
    return <p className="text-xs text-muted">暫時讀不到上次匯入的紀錄，不影響這次匯入。</p>;
  }
  const r = info.record;
  if (!r) return null;
  if (r.status === 'running') {
    return (
      <Banner kind="warning" title="上次匯入沒有做完">
        <span className="break-words">
          {`${fmtDateTime(r.startedAt)} 開始，共 ${n(r.totalProducts)} 件，已完成 ${n(r.created + r.updated)} 件。`}
          {`把同一批檔案（${r.files.map((f) => f.fileName).join('、')}）再放進來，就會從沒做完的地方接著做。`}
        </span>
      </Banner>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 rounded-md border border-line bg-subtle px-3 py-2.5 text-sm">
      <CircleCheck size={16} className="text-success" aria-hidden="true" />
      <span>上次匯入：{fmtDateTime(r.startedAt)}・完成</span>
      <span className="text-muted">
        新增 {n(r.created)}・更新 {n(r.updated)}・失敗 {n(r.failed)}・略過 {n(r.skipped)}
        {r.skippedImages > 0 && `・略過圖片 ${n(r.skippedImages)} 張`}
      </span>
    </p>
  );
}

export default function StepFiles({ lib, ensureLib, entries, setEntries, lastImport, announce, focusHeading, onNext }: Props) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>(focusHeading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const done = entries.flatMap((e) => (e.state === 'done' ? [e] : []));
  const parsing = entries.some((e) => e.state === 'parsing');
  const analysis = useMemo(() => {
    const intakes = entries.flatMap((e) => (e.state === 'done' ? [e.intake] : []));
    return lib && intakes.length > 0 ? lib.analyzeFileSet(intakes) : null;
  }, [lib, entries]);

  const addFiles = async (files: File[]) => {
    setLoadError(null);
    let l: ShopeeImportLib;
    try {
      l = await ensureLib();
    } catch {
      setLoadError('無法載入匯入工具，請確認網路連線後再試一次。');
      return;
    }
    const added: Entry[] = files.map((f) => ({ id: nextId(), fileName: f.name, state: 'parsing' }));
    setEntries((prev) => [...prev, ...added]);
    announce(`收到 ${files.length} 個檔案，辨識中`);
    for (let i = 0; i < files.length; i++) {
      await tick(); // 讓「辨識中」先畫出來，再做同步的解析
      const f = files[i];
      const intake: FileIntake = f.size > MAX_FILE_BYTES
        ? { ok: false, fileName: f.name, reason: 'FILE_TOO_LARGE' }
        : l.readShopeeFile(f.name, await f.arrayBuffer());
      setEntries((prev) => prev.map((e): Entry => (e.id === added[i].id ? { ...e, state: 'done', intake } : e)));
      announce(intake.ok
        ? `${f.name}：辨識為${KIND_LABEL[intake.sheet.kind]}，${n(intake.sheet.productCount)} 件商品`
        : `${f.name}：${intake.reason === 'DTS_FILE' ? '是配送設定檔，好物集用不到' : intake.reason === 'FILE_TOO_LARGE' ? '檔案太大' : '不是蝦皮匯出的商品檔'}`);
    }
  };

  const remove = (id: string, fileName: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    announce(`已移除 ${fileName}`);
  };

  // ── 依辨識結果整理出畫面要的東西 ──
  const issues: FileSetIssue[] = analysis?.issues ?? [];
  const sheetEntries = done.flatMap((e) => (e.intake.ok ? [{ id: e.id, sheet: e.intake.sheet }] : []));
  const byKind = (k: ImportFileKind) => sheetEntries.filter((s) => s.sheet.kind === k);

  const shopCounts = new Map<string, number>();
  for (const s of sheetEntries) shopCounts.set(s.sheet.externalShopId, (shopCounts.get(s.sheet.externalShopId) ?? 0) + 1);
  const top = Math.max(0, ...shopCounts.values());
  const topIds = [...shopCounts].filter(([, c]) => c === top).map(([id]) => id);
  // 店家 ID 不一致時，與多數不同的那列標錯誤；沒有明確多數（例如三個都不同）就全部標錯
  const majorityShop = shopCounts.size > 1 && topIds.length === 1 ? topIds[0] : null;
  const mismatch = issues.find((i): i is Extract<FileSetIssue, { code: 'SHOP_MISMATCH' }> => i.code === 'SHOP_MISMATCH');
  const flaggedShop = (s: ParsedSheet) => Boolean(mismatch) && s.externalShopId !== majorityShop;

  const missingCols = (s: ParsedSheet) => issues.find(
    (i): i is Extract<FileSetIssue, { code: 'MISSING_COLUMNS' }> => i.code === 'MISSING_COLUMNS' && i.fileName === s.fileName && i.kind === s.kind,
  );
  const missingKind = issues.find((i): i is Extract<FileSetIssue, { code: 'MISSING_KIND' }> => i.code === 'MISSING_KIND');
  const tooMany = issues.find((i): i is Extract<FileSetIssue, { code: 'TOO_MANY_PRODUCTS' }> => i.code === 'TOO_MANY_PRODUCTS');
  const hasDuplicate = issues.some((i) => i.code === 'DUPLICATE_KIND');
  const hasProblemRows = issues.some((i) => i.code !== 'MISSING_KIND');

  const ready = analysis !== null && analysis.canProceed && analysis.sheets !== null && analysis.externalShopId !== null;
  // 上次沒做完、而且這次放的是同一批檔案 → 接續（預覽頁會用最新的紀錄再判定一次）
  const lastRecord = lastImport.state === 'ready' ? lastImport.record : null;
  const resume = ready && analysis.sheets && analysis.externalShopId
    ? matchResume(lastRecord, { externalShopId: analysis.externalShopId, sheets: analysis.sheets })
    : null;
  const hint = (() => {
    if (entries.length === 0) return '三個檔案都放進來，才能繼續。';
    if (parsing) return '辨識完成後才能繼續。';
    if (ready && resume) return `三個檔案都放好了，會接續上次匯入，還剩 ${n(resume.remaining)} 件。`;
    if (ready && lastRecord?.status === 'running') {
      return `三個檔案都放好了（共 ${n(analysis.totalProducts ?? 0)} 件商品）。這批檔案和上次沒做完的匯入不同，會當作新的匯入。`;
    }
    if (ready) return `三個檔案都放好了（共 ${n(analysis.totalProducts ?? 0)} 件商品。）`;
    if (hasDuplicate) return '請先移除重複的檔案。';
    if (hasProblemRows) return '請先移除有問題的檔案。';
    return '補上缺的檔案就能繼續。';
  })();

  const sheetDetail = (s: ParsedSheet) => (
    `${s.fileName}・${n(s.productCount)} 件商品${s.kind === 'sales_info' ? `、${n(s.rowCount)} 列規格` : ''}・店家 ID ${s.externalShopId}`
  );

  const columnsMessage = (s: ParsedSheet, issue: Extract<FileSetIssue, { code: 'MISSING_COLUMNS' }>) => {
    const all = issue.columns.map((c) => `${c.label}（${c.key}）`);
    const open = expanded.has(s.fileName);
    const shown = open ? all : all.slice(0, 3);
    return (
      <>
        {KIND_LABEL[s.kind]}缺少必要欄位：{shown.join('、')}
        {all.length > 3 && !open && `…共 ${all.length} 個欄位`}
        {all.length > 3 && (
          <button
            type="button" className="ml-2 underline"
            onClick={() => setExpanded((prev) => {
              const next = new Set(prev);
              if (open) next.delete(s.fileName); else next.add(s.fileName);
              return next;
            })}
          >
            {open ? '收合' : '查看全部'}
          </button>
        )}
      </>
    );
  };

  const slotRow = (k: ImportFileKind) => {
    const files = byKind(k);
    if (files.length === 0) return <FileRow key={k} state="empty" title={KIND_LABEL[k]} kindKey={k} />;
    if (files.length > 1) {
      return (
        <FileRow
          key={k} state="error" title={KIND_LABEL[k]} kindKey={k}
          message={`「${files[0].sheet.fileName}」和「${files[1].sheet.fileName}」都是「${KIND_LABEL[k]}」，請移除其中一個`}
        />
      );
    }
    const { id, sheet } = files[0];
    const cols = missingCols(sheet);
    const badShop = flaggedShop(sheet);
    const message = cols
      ? columnsMessage(sheet, cols)
      : badShop ? `店家 ID ${sheet.externalShopId}，和其他兩個檔案不同` : undefined;
    return (
      <FileRow
        key={k} state={message ? 'error' : 'ready'} title={KIND_LABEL[k]} kindKey={k}
        detail={sheetDetail(sheet)} message={message}
        onRemove={() => remove(id, sheet.fileName)} removeLabel={`移除 ${sheet.fileName}`}
      />
    );
  };

  const extraRows = entries.flatMap((e) => {
    if (e.state === 'parsing') return [<FileRow key={e.id} state="parsing" title={e.fileName} />];
    const rm = { onRemove: () => remove(e.id, e.fileName), removeLabel: `移除 ${e.fileName}` };
    if (!e.intake.ok) {
      const { reason } = e.intake;
      if (reason === 'DTS_FILE') {
        return [<FileRow key={e.id} state="notice" title={e.fileName} message={`「${e.fileName}」是配送設定檔，好物集用不到，移除後就能繼續`} {...rm} />];
      }
      return [<FileRow key={e.id} state="error" title={e.fileName} {...rm}
        message={reason === 'FILE_TOO_LARGE' ? `「${e.fileName}」檔案太大（上限 50 MB）` : `「${e.fileName}」不是蝦皮匯出的商品檔`} />];
    }
    const same = byKind(e.intake.sheet.kind);
    if (same.length > 1) {
      const other = same.find((s) => s.id !== e.id);
      return [<FileRow key={e.id} state="error" title={e.fileName} {...rm}
        message={`與「${other?.sheet.fileName ?? ''}」重複，請移除其中一個`} />];
    }
    return [];
  });

  return (
    <section aria-labelledby="step1-title" className="space-y-4">
      <div>
        <h2 id="step1-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">放入蝦皮匯出的檔案</h2>
        <p className="mt-1 text-sm text-muted">把蝦皮匯出的 3 個商品檔放進來就好，不用管檔名和順序。</p>
      </div>

      <LastImportInfo info={lastImport} />

      <Dropzone onFiles={(f) => void addFiles(f)} />
      {loadError && <Banner kind="error" title="無法載入匯入工具">{loadError}</Banner>}

      <ul className="space-y-2" aria-label="已放入的檔案">
        {ALL_KINDS.map(slotRow)}
        {extraRows}
      </ul>

      <div aria-live="polite" className="space-y-2">
        {mismatch && (
          <Banner kind="error" title={`三個檔案來自不同的蝦皮賣場（${mismatch.shopIds.join('、')}）`}>
            請確認三個檔案都是從同一個蝦皮賣場匯出的。
          </Banner>
        )}
        {tooMany && <Banner kind="error" title={`這批共 ${n(tooMany.total)} 件，一次最多 ${n(tooMany.limit)} 件，請在蝦皮分批匯出`} />}
        {missingKind && entries.length > 0 && !parsing && (
          <Banner kind="info" title={missingKind.message} role="none" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p id="step1-hint" className="text-sm text-muted">{hint}</p>
        <button
          type="button" aria-disabled={!ready} aria-describedby="step1-hint" className={btnPrimary}
          onClick={() => { if (ready) onNext({ ...analysis, sheets: analysis.sheets!, externalShopId: analysis.externalShopId! }); }}
        >
          {resume ? '下一步：接續匯入' : '下一步：確認預覽'}
        </button>
      </div>
    </section>
  );
}
