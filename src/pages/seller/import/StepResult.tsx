import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Download, TriangleAlert } from 'lucide-react';
import Banner from '../../../components/import/Banner';
import KPI from '../../../components/import/KPI';
import { btnOutline, btnPrimaryLg } from '../../../components/import/ui';
import { XLSX_MIME, ZIP_MIME, downloadBytes, failureZipName } from '../../../lib/import/download';
import type { ShopeeImportLib } from '../../../lib/import/loader';
import type { RunnerOutcome } from '../../../lib/import/runner';
import { buildZip } from '../../../lib/import/zip';
import type { FailureFile } from '../../../lib/shopee-import/failure';
import type { ImportFileKind } from '../../../types';
import { n, useFocusOnMount, type ReadyAnalysis } from './shared';

const LIST_LIMIT = 20;

interface Props {
  lib: ShopeeImportLib;
  analysis: ReadyAnalysis;
  outcome: RunnerOutcome;
  /** 預覽判定的略過件數（因「略過已售完」不送出的件數） */
  skipped: number;
  /** 沒有 record（紀錄沒存成功、直接看結果）時用本地統計的失敗件數 */
  localFailed: number;
  titles: Record<string, string>;
  onAgain: () => void;
}

const KIND_ORDER: ImportFileKind[] = ['basic_info', 'sales_info', 'media_info'];
const KIND_SHEET = { basic_info: 'basic', sales_info: 'sales', media_info: 'media' } as const;
const KIND_LABEL_SHORT: Record<ImportFileKind, string> = {
  basic_info: '商品標題及描述', sales_info: '價格及庫存', media_info: '媒體資訊',
};

export default function StepResult({ lib, analysis, outcome, skipped, localFailed, titles, onAgain }: Props) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const { record } = outcome;
  // 四個數字以資料庫的匯入紀錄為準（與下次進精靈看到的「上次匯入」一致）；紀錄沒存成功時用本地統計
  const created = record?.created ?? outcome.created;
  const updated = record?.updated ?? outcome.updated;
  const failed = record?.failed ?? localFailed;
  const skip = record?.skipped ?? skipped;
  const skippedImageCount = record?.skippedImages ?? outcome.skippedImages.length;
  const imported = created + updated;

  const reasons = useMemo(
    () => Object.fromEntries(outcome.failures.map((f) => [f.sourceProductId, f.reason])),
    [outcome.failures],
  );

  const headline = (() => {
    if (imported === 0 && failed > 0) {
      return { kind: 'error' as const, title: '沒有商品匯入成功', sub: `${n(failed)} 件都沒有匯入。下載失敗原因檔，看看是哪裡的問題。` };
    }
    const imageTail = skippedImageCount > 0 ? `，但有 ${n(skippedImageCount)} 張圖片沒有轉存成功，詳見下方` : '';
    if (failed > 0) {
      return {
        kind: 'warning' as const, title: `匯入完成，有 ${n(failed)} 件商品沒有匯入`,
        sub: skippedImageCount > 0
          ? `其他 ${n(imported)} 件已經匯入，另外有 ${n(skippedImageCount)} 張圖片被略過，詳見下方。`
          : `其他 ${n(imported)} 件已經匯入。下載失敗原因檔，修正後再匯入就能補上。`,
      };
    }
    const done = updated === 0
      ? `${n(created)} 件商品已新增到好物集`
      : `共 ${n(imported)} 件商品已匯入好物集（新增 ${n(created)}、更新 ${n(updated)}）`;
    return { kind: 'success' as const, title: '匯入完成', sub: `${done}${imageTail}。` };
  })();

  const buildFiles = () => lib.buildFailureFiles(analysis.sheets, reasons);

  const downloadZip = () => {
    const files = buildFiles();
    const sheets = analysis.sheets;
    const entries = KIND_ORDER.map((k) => {
      const f = files[KIND_SHEET[k]];
      return { name: `失敗原因_${sheets[KIND_SHEET[k]].fileName}`, bytes: f.bytes };
    });
    downloadBytes(failureZipName(analysis.externalShopId), buildZip(entries), ZIP_MIME);
  };

  const downloadOne = (k: ImportFileKind) => {
    const f: FailureFile = buildFiles()[KIND_SHEET[k]];
    downloadBytes(`失敗原因_${analysis.sheets[KIND_SHEET[k]].fileName}`, f.bytes, XLSX_MIME);
  };

  const HeadIcon = headline.kind === 'success' ? CircleCheck : headline.kind === 'warning' ? TriangleAlert : CircleAlert;
  const headColor = headline.kind === 'success' ? 'text-success' : headline.kind === 'warning' ? 'text-warning-text' : 'text-error-text';
  const failureRows = outcome.failures.slice(0, LIST_LIMIT);
  const nameOf = (id: string) => titles[id] ?? '（檔案裡沒有名稱）';

  return (
    <section aria-labelledby="step4-title" className="space-y-5">
      <div role="status" className="flex items-start gap-3">
        <HeadIcon size={28} className={`mt-0.5 shrink-0 ${headColor}`} aria-hidden="true" />
        <div>
          <h2 id="step4-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">{headline.title}</h2>
          <p className="mt-1 text-sm">{headline.sub}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KPI kind="new" label="已新增（件）" value={created} />
        <KPI kind="update" label="已更新（件）" value={updated} />
        <KPI kind="error" label="失敗（件）" value={failed} />
        <KPI kind="skip" label="略過（件）" value={skip} />
      </div>
      <p className="text-sm text-muted tabular-nums">上架 {n(outcome.active)} 件・下架 {n(outcome.hidden)} 件</p>

      {!record && (
        <Banner kind="warning" title="這次的匯入紀錄沒有存成功" role="none">
          上面的數字是這個分頁自己統計的。商品都已匯入；下次進精靈會看到這次顯示為「未完成」。
        </Banner>
      )}

      {outcome.failures.length > 0 && (
        <div className="space-y-3 rounded-lg border border-line bg-white p-4 md:p-6">
          <h3 className="font-bold">沒有匯入的商品（{n(outcome.failures.length)}）</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr><th className="py-2 pr-3 font-normal">商品 ID</th><th className="py-2 pr-3 font-normal">商品名稱</th><th className="py-2 font-normal">原因</th></tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {failureRows.map((f) => (
                  <tr key={f.sourceProductId}>
                    <td className="py-2.5 pr-3 tabular-nums">{f.sourceProductId}</td>
                    <td className="py-2.5 pr-3 break-words">{nameOf(f.sourceProductId)}</td>
                    <td className="py-2.5 break-words">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outcome.failures.length > LIST_LIMIT && (
            <p className="text-xs text-muted">只列出前 {LIST_LIMIT} 件，其餘請看失敗原因檔。</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className={btnPrimaryLg} onClick={downloadZip}>
              <Download size={18} aria-hidden="true" />下載失敗原因檔（.zip）
            </button>
          </div>
          <p className="text-xs text-muted">內含 3 個 .xlsx，只有這幾件商品的資料列，「失敗原因」欄已填好。修正後三個檔一起丟回步驟 1 就能補匯。</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">或單獨下載：</span>
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" className={btnOutline} onClick={() => downloadOne(k)}>{KIND_LABEL_SHORT[k]}</button>
            ))}
          </div>
        </div>
      )}

      {outcome.skippedImages.length > 0 && (
        <div className="space-y-3 rounded-lg border border-line bg-white p-4 md:p-6">
          <h3 className="font-bold">被略過的圖片（{n(outcome.skippedImages.length)} 張）</h3>
          <p className="text-sm">這些商品已照常匯入，只是缺了這幾張圖。再匯入一次同一批檔案，會重新嘗試轉存。</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-normal">商品 ID</th><th className="py-2 pr-3 font-normal">商品名稱</th>
                  <th className="py-2 pr-3 font-normal">位置</th><th className="py-2 font-normal">原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {outcome.skippedImages.map((s) => (
                  <tr key={`${s.sourceProductId}:${s.slot}`}>
                    <td className="py-2.5 pr-3 tabular-nums">{s.sourceProductId}</td>
                    <td className="py-2.5 pr-3 break-words">{nameOf(s.sourceProductId)}</td>
                    <td className="py-2.5 pr-3 break-words">{lib.slotLabel(s.slot)}</td>
                    <td className="py-2.5">{s.code === 'IMAGE_DOWNLOAD_FAILED' ? '下載失敗，已略過' : '上傳失敗，已略過'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Link to="/seller/products" className={btnPrimaryLg}>前往我的商品</Link>
        <button type="button" className={btnOutline} onClick={onAgain}>再匯入一批</button>
      </div>
    </section>
  );
}
