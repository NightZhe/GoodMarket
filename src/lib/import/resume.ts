import type { ImportFileKind, ImportRecord } from '../../types';

// 斷點續傳的判定（純函式）。上次沒做完的匯入，若這次放進來的是「同一批檔案」，
// 就接著同一筆匯入紀錄做完；檔名不同可能是重新匯出的新檔，走一般流程（已寫入的商品變成更新）。

export interface ResumeAnalysis {
  externalShopId: string;
  sheets: Record<'basic' | 'sales' | 'media', { fileName: string }>;
}

export interface ResumeMatch {
  record: ImportRecord;
  /** 上次已寫入（新增或更新）的商品；失敗的不算，續傳時會再試一次 */
  doneIds: Set<string>;
  /** 還沒做完的件數（總件數 − 已完成），給步驟 1 的提示用 */
  remaining: number;
}

const SHEET_KIND: Record<keyof ResumeAnalysis['sheets'], ImportFileKind> = {
  basic: 'basic_info', sales: 'sales_info', media: 'media_info',
};

export function matchResume(lastImport: ImportRecord | null, analysis: ResumeAnalysis): ResumeMatch | null {
  if (!lastImport || lastImport.status !== 'running') return null;
  if (lastImport.externalShopId !== analysis.externalShopId) return null;

  for (const key of Object.keys(SHEET_KIND) as (keyof typeof SHEET_KIND)[]) {
    const saved = lastImport.files.find((f) => f.kind === SHEET_KIND[key]);
    if (saved?.fileName !== analysis.sheets[key].fileName) return null;
  }

  const doneIds = new Set(
    (lastImport.progress?.items ?? []).filter((i) => i.outcome !== 'failed').map((i) => i.sourceProductId),
  );
  return { record: lastImport, doneIds, remaining: Math.max(0, lastImport.totalProducts - doneIds.size) };
}
