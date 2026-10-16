import type { CategoryId, ImportIndex } from '../../types';
import type {
  ParsedProduct, PreviewAction, PreviewCounts, PreviewOptions, PreviewResult, PreviewRow,
  ProductIssue, ProductWarningCode,
} from './types';

export const CATEGORY_OTHER_ISSUE: ProductIssue<'CATEGORY_OTHER'> = {
  code: 'CATEGORY_OTHER',
  message: '分類對不上，先歸在「其他」，建議改選分類',
};

const WARNING_CODES: ProductWarningCode[] = [
  'CATEGORY_OTHER', 'LOOKS_LIKE_TOP_UP', 'DESCRIPTION_OVER_EDITOR_LIMIT',
];

/** 賣家在預覽頁改過分類就用改過的，否則用對照表結果 */
export function effectiveCategory(
  p: ParsedProduct,
  overrides: Readonly<Record<string, CategoryId>> = {},
): CategoryId {
  return overrides[p.sourceProductId] ?? p.mappedCategoryId;
}

/**
 * 預覽分類（F-2）。輸入：轉換結果、get_import_index 回傳值（乾淨店可傳 null）、兩個開關、分類修改。
 * - 有任何商品層錯誤 → error（不匯入）
 * - 已存在本店 → update；**開關不影響已存在的商品**（Q-2）
 * - 新商品：「略過已售完」開且全規格庫存 0 → skip；否則 create
 * - 新商品狀態：「全部先下架」→ 下架；否則有庫存上架、售完下架（F-5.5）
 * - 既有商品狀態：全規格庫存 0 → 下架；否則維持原狀（F-5.6）。
 *   資料庫會把賣家手動新增的規格也算進「所有規格」，預覽看不到它們，所以更新商品的 afterStatus 是推算值。
 */
export function buildPreview(
  products: ParsedProduct[],
  index: ImportIndex | null,
  options: PreviewOptions,
  categoryOverrides: Readonly<Record<string, CategoryId>> = {},
): PreviewResult {
  const existing = new Map(index?.products.map((p) => [p.sourceProductId, p.status]) ?? []);

  const rows: PreviewRow[] = products.map((p) => {
    const categoryId = effectiveCategory(p, categoryOverrides);
    const existingStatus = existing.get(p.sourceProductId);
    const isExisting = existingStatus !== undefined;

    let action: PreviewAction;
    if (p.errors.length > 0) action = 'error';
    else if (isExisting) action = 'update';
    else if (options.skipSoldOut && p.soldOut) action = 'skip';
    else action = 'create';

    let afterStatus: PreviewRow['afterStatus'] = null;
    if (action === 'create') {
      afterStatus = options.allHidden || p.soldOut ? 'hidden' : 'active';
    } else if (action === 'update') {
      afterStatus = p.soldOut ? 'hidden' : (existingStatus ?? null);
    }

    const prices = p.variants.flatMap((v) => (v.price === null ? [] : [v.price]));
    const warnings: ProductIssue<ProductWarningCode>[] = [
      ...(categoryId === 'other' ? [CATEGORY_OTHER_ISSUE] : []),
      ...p.warnings,
    ];

    return {
      sourceProductId: p.sourceProductId,
      title: p.title,
      coverUrl: p.images.find((i) => i.slot === 'cover')?.sourceUrl ?? null,
      categoryId,
      variantCount: p.variants.length,
      priceMin: prices.length > 0 ? Math.min(...prices) : null,
      priceMax: prices.length > 0 ? Math.max(...prices) : null,
      totalStock: p.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0),
      soldOut: p.soldOut,
      action,
      existing: isExisting,
      afterStatus,
      errors: p.errors,
      warnings,
    };
  });

  const warningsByCode = Object.fromEntries(WARNING_CODES.map((c) => [c, 0])) as Record<ProductWarningCode, number>;
  const counts: PreviewCounts = {
    total: rows.length, created: 0, updated: 0, errors: 0, skipped: 0,
    warnings: 0, problems: 0, warningsByCode,
  };
  for (const r of rows) {
    if (r.action === 'create') counts.created++;
    else if (r.action === 'update') counts.updated++;
    else if (r.action === 'error') counts.errors++;
    else counts.skipped++;
    // 「需要注意」只算會被匯入的商品
    if ((r.action === 'create' || r.action === 'update') && r.warnings.length > 0) {
      counts.warnings++;
      for (const w of r.warnings) warningsByCode[w.code]++;
    }
  }
  counts.problems = counts.errors + counts.warnings;

  return { rows, counts, canStart: counts.created + counts.updated > 0 };
}
