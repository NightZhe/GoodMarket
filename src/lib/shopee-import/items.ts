import type { DraftImage, ImportItemDraft, ParsedProduct, PreviewResult } from './types';

/**
 * 由預覽結果產出待送的 ImportItem 草稿（只含 create／update 的商品，依檔案順序）。
 * 圖片只有 sourceUrl 與 slot；已轉存的好物集網址（url）由圖片轉存步驟填入。
 * slot：'cover'、'image:N'（商品圖片 N）、'option:〈選項名稱〉'，回報略過圖片時要用。
 */
export function buildImportItemDrafts(products: ParsedProduct[], preview: PreviewResult): ImportItemDraft[] {
  const byId = new Map(products.map((p) => [p.sourceProductId, p]));
  const drafts: ImportItemDraft[] = [];
  for (const row of preview.rows) {
    if ((row.action !== 'create' && row.action !== 'update') || row.afterStatus === null) continue;
    const p = byId.get(row.sourceProductId);
    if (!p) continue;
    drafts.push({
      sourceProductId: p.sourceProductId,
      title: p.title,
      description: p.description,
      categoryId: row.categoryId,
      status: row.afterStatus,
      images: p.images.map((i): DraftImage => ({ sourceUrl: i.sourceUrl, slot: i.slot })),
      variants: p.variants.map((v) => {
        // 沒有商品層錯誤的商品，價格與庫存必為合法整數；違反代表預覽與轉換不一致
        if (v.price === null || v.stock === null) {
          throw new Error(`商品 ${p.sourceProductId} 規格 ${v.sourceVariantId} 價格或庫存不合法，不應進入匯入`);
        }
        return {
          sourceVariantId: v.sourceVariantId,
          name: v.name,
          price: v.price,
          stock: v.stock,
          image: v.image ? { sourceUrl: v.image.sourceUrl, slot: v.image.slot } : null,
        };
      }),
    });
  }
  return drafts;
}
