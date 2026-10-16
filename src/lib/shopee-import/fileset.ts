import type { ImportFileKind } from '../../types';
import { ALL_KINDS, KIND_LABEL, MAX_PRODUCTS_PER_IMPORT } from './constants';
import type { FileIntake, FileSetAnalysis, FileSetIssue, ParsedSheet } from './types';

const kindName = (k: ImportFileKind) => `${KIND_LABEL[k]}（${k}）`;

/**
 * 檢查目前放入的所有檔案（E-1.1～E-1.8）。可分批放入、每次重算。
 * 訊息是預設中文（語意固定，措辭 T1 可潤飾）；畫面應依 code 與欄位自行組字。
 */
export function analyzeFileSet(intakes: FileIntake[]): FileSetAnalysis {
  const issues: FileSetIssue[] = [];
  const sheets: ParsedSheet[] = [];

  for (const it of intakes) {
    if (it.ok) {
      sheets.push(it.sheet);
    } else if (it.reason === 'FILE_TOO_LARGE') {
      issues.push({ code: 'FILE_TOO_LARGE', fileName: it.fileName, message: `${it.fileName}太大（上限 10 MB）` });
    } else if (it.reason === 'DTS_FILE') {
      issues.push({
        code: 'DTS_FILE', fileName: it.fileName,
        message: `${it.fileName}是配送設定檔，好物集不需要，可以移除`,
      });
    } else {
      issues.push({
        code: 'NOT_SHOPEE_FILE', fileName: it.fileName,
        message: `${it.fileName}不是蝦皮匯出的商品檔`,
      });
    }
  }

  const byKind = new Map<ImportFileKind, ParsedSheet[]>();
  for (const s of sheets) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);

  const missing = ALL_KINDS.filter((k) => !byKind.has(k));
  if (missing.length > 0) {
    issues.push({
      code: 'MISSING_KIND', kinds: [...missing],
      message: `還缺：${missing.map(kindName).join('、')}`,
    });
  }

  for (const kind of ALL_KINDS) {
    const list = byKind.get(kind) ?? [];
    if (list.length > 1) {
      const fileNames = list.map((s) => s.fileName);
      issues.push({
        code: 'DUPLICATE_KIND', kind, fileNames,
        message: `${fileNames.join('和')}都是${KIND_LABEL[kind]}，請移除其中一個`,
      });
    }
  }

  const shopIds = [...new Set(sheets.map((s) => s.externalShopId))];
  if (shopIds.length > 1) {
    issues.push({
      code: 'SHOP_MISMATCH', shopIds,
      message: `三個檔來自不同的蝦皮賣場（${shopIds.join('、')}）`,
    });
  }

  for (const s of sheets) {
    if (s.missingColumns.length > 0) {
      issues.push({
        code: 'MISSING_COLUMNS', kind: s.kind, fileName: s.fileName, columns: s.missingColumns,
        message: `${KIND_LABEL[s.kind]}缺少必要欄位：${s.missingColumns.map((c) => `${c.label}（${c.key}）`).join('、')}`,
      });
    }
  }

  const complete = ALL_KINDS.every((k) => byKind.get(k)?.length === 1);
  let totalProducts: number | null = null;
  if (complete) {
    const union = new Set<string>();
    for (const s of sheets) for (const id of s.productIds) union.add(id);
    totalProducts = union.size;
    if (totalProducts > MAX_PRODUCTS_PER_IMPORT) {
      issues.push({
        code: 'TOO_MANY_PRODUCTS', total: totalProducts, limit: MAX_PRODUCTS_PER_IMPORT,
        message: `這批共 ${totalProducts} 件，一次最多 ${MAX_PRODUCTS_PER_IMPORT} 件，請在蝦皮分批匯出`,
      });
    }
  }

  const canProceed = complete && issues.length === 0;
  const only = (k: ImportFileKind) => byKind.get(k)?.[0];
  const basic = only('basic_info');
  const sales = only('sales_info');
  const media = only('media_info');

  return {
    issues,
    canProceed,
    sheets: complete && basic && sales && media ? { basic, sales, media } : null,
    totalProducts,
    externalShopId: shopIds.length === 1 ? shopIds[0] : null,
  };
}
