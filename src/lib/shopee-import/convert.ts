import type { ImportFileKind } from '../../types';
import { mapShopeeCategory, parseShopeeCategoryId } from './categories';
import {
  DEFAULT_VARIANT_NAME, DESCRIPTION_EDITOR_LIMIT, EXTRA_IMAGE_SLOTS, KEY, KIND_LABEL,
  MAX_IMAGES_PER_PRODUCT, OPTION_SLOTS, PRICE_MAX, PRICE_MIN, TITLE_MAX, TITLE_MIN,
  TOP_UP_KEYWORDS, TOP_UP_PRICE_BELOW, imageKey, optionImageKey, optionNameKey,
} from './constants';
import { cellText } from './sheet';
import { codePointLength, normalizeDescription, parseNonNegativeInt } from './text';
import type {
  ParsedProduct, ParsedSheet, ParsedVariant, ProductIssue, ProductErrorCode, ProductWarningCode,
  SheetRow, SheetSet, SourceImage,
} from './types';

const groupByProduct = (sheet: ParsedSheet): Map<string, SheetRow[]> => {
  const map = new Map<string, SheetRow[]>();
  for (const row of sheet.rows) {
    const id = cellText(sheet, row, KEY.productId);
    if (id === '') continue;
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
};

/** 規格名稱攤平（F-5）：空白 → 標準款；半形逗號 → ' / ' */
export function flattenVariantName(raw: string): string {
  const name = raw.trim();
  return name === '' ? DEFAULT_VARIANT_NAME : name.replaceAll(',', ' / ');
}

/**
 * 規格圖對應（F-5.2）：sales 原始規格名稱 N 對到第一層選項 O 的條件為
 * N == O 或 N 以 O + "," 開頭；多個符合取最長的 O。
 */
export function matchOption<T extends { name: string }>(rawName: string, options: T[]): T | null {
  let best: T | null = null;
  for (const o of options) {
    if (o.name === '') continue;
    if (rawName === o.name || rawName.startsWith(`${o.name},`)) {
      if (best === null || o.name.length > best.name.length) best = o;
    }
  }
  return best;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function readOptions(media: ParsedSheet, row: SheetRow): { name: string; imageUrl: string }[] {
  return range(OPTION_SLOTS).map((k) => ({
    name: cellText(media, row, optionNameKey(k)),
    imageUrl: cellText(media, row, optionImageKey(k)),
  }));
}

function issue<C extends string>(code: C, message: string): ProductIssue<C> {
  return { code, message };
}

const showRaw = (raw: string) => (raw === '' ? '（空白）' : raw);

/**
 * 三檔串接與轉換（F-5、F-2 的商品層錯誤與提醒）。
 * 商品清單是三檔商品 ID 的聯集（依 basic、media、sales 的出現順序）。
 * 只檢查「該檔有這件商品」的內容：缺檔的商品只報 MISSING_IN_FILE，不再附帶其他錯誤。
 */
export function convertSheets(sheets: SheetSet): ParsedProduct[] {
  const { basic, sales, media } = sheets;
  const basicRows = groupByProduct(basic);
  const salesRows = groupByProduct(sales);
  const mediaRows = groupByProduct(media);

  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of [basic, media, sales]) {
    for (const id of s.productIds) {
      if (!seen.has(id)) { seen.add(id); order.push(id); }
    }
  }

  return order.map((id) => {
    const bRows = basicRows.get(id) ?? [];
    const sRows = salesRows.get(id) ?? [];
    const mRows = mediaRows.get(id) ?? [];
    const presentIn: Record<ImportFileKind, boolean> = {
      basic_info: bRows.length > 0, sales_info: sRows.length > 0, media_info: mRows.length > 0,
    };
    const errors: ProductIssue<ProductErrorCode>[] = [];
    const warnings: ProductIssue<ProductWarningCode>[] = [];

    const missingKinds = (Object.keys(presentIn) as ImportFileKind[]).filter((k) => !presentIn[k]);
    if (missingKinds.length > 0) {
      errors.push(issue('MISSING_IN_FILE',
        `這件商品沒有同時出現在三個檔（缺：${missingKinds.map((k) => KIND_LABEL[k]).join('、')}）`));
    }

    // 基本資料
    const bRow = bRows[0];
    const title = bRow ? cellText(basic, bRow, KEY.productName) : '';
    const description = bRow ? normalizeDescription(cellText(basic, bRow, KEY.description)) : '';

    // 媒體資料
    const mRow = mRows[0];
    const shopeeCategory = mRow ? cellText(media, mRow, KEY.category) : '';
    const images: SourceImage[] = [];
    let hasCover = false;
    let options: { name: string; imageUrl: string }[] = [];
    if (mRow) {
      const cover = cellText(media, mRow, KEY.cover);
      hasCover = cover !== '';
      if (hasCover) images.push({ slot: 'cover', sourceUrl: cover });
      for (const n of range(EXTRA_IMAGE_SLOTS)) {
        const url = cellText(media, mRow, imageKey(n));
        if (url !== '') images.push({ slot: `image:${n}`, sourceUrl: url });
      }
      options = readOptions(media, mRow);
    }

    // 規格
    const variants: ParsedVariant[] = [];
    const variantIds = new Set<string>();
    let duplicateVariantRows = false;
    for (const row of sRows) {
      const sourceVariantId = cellText(sales, row, KEY.variationId);
      if (variantIds.has(sourceVariantId)) { duplicateVariantRows = true; continue; }
      variantIds.add(sourceVariantId);
      const rawName = cellText(sales, row, KEY.variationName);
      const rawPrice = cellText(sales, row, KEY.variationPrice);
      const rawStock = cellText(sales, row, KEY.variationStock);
      const priceNum = parseNonNegativeInt(rawPrice);
      const stockNum = parseNonNegativeInt(rawStock);
      const opt = matchOption(rawName, options);
      variants.push({
        sourceVariantId, rawName,
        name: flattenVariantName(rawName),
        rawPrice, rawStock,
        price: priceNum !== null && priceNum >= PRICE_MIN && priceNum <= PRICE_MAX ? priceNum : null,
        stock: stockNum,
        image: opt && opt.imageUrl !== '' ? { slot: `option:${opt.name}`, sourceUrl: opt.imageUrl } : null,
      });
    }

    // 商品層錯誤（F-2）
    const dupKinds: ImportFileKind[] = [];
    if (bRows.length > 1) dupKinds.push('basic_info');
    if (duplicateVariantRows) dupKinds.push('sales_info');
    if (mRows.length > 1) dupKinds.push('media_info');
    for (const k of dupKinds) {
      errors.push(issue('DUPLICATE_ROW', `同一件商品／規格在${KIND_LABEL[k]}出現兩次`));
    }
    if (presentIn.basic_info) {
      const n = codePointLength(title);
      if (n < TITLE_MIN || n > TITLE_MAX) {
        errors.push(issue('TITLE_LENGTH', `商品名稱需為 ${TITLE_MIN}–${TITLE_MAX} 字，目前 ${n} 字`));
      }
    }
    if (presentIn.media_info && !hasCover) {
      errors.push(issue('MISSING_COVER', '缺少主商品圖片'));
    }
    if (presentIn.sales_info) {
      for (const v of variants) {
        if (v.price === null) {
          errors.push(issue('PRICE_INVALID',
            `規格「${v.name}」的價格需為 ${PRICE_MIN}–${PRICE_MAX.toLocaleString('en-US')} 的整數，目前為「${showRaw(v.rawPrice)}」`));
        }
      }
      for (const v of variants) {
        if (v.stock === null) {
          errors.push(issue('STOCK_INVALID',
            `規格「${v.name}」的庫存需為 0 以上的整數，目前為「${showRaw(v.rawStock)}」`));
        }
      }
      const names = new Set<string>();
      const reported = new Set<string>();
      for (const v of variants) {
        if (names.has(v.name) && !reported.has(v.name)) {
          reported.add(v.name);
          errors.push(issue('VARIANT_NAME_DUPLICATE', `規格名稱「${v.name}」重複`));
        }
        names.add(v.name);
      }
    }

    // 商品層提醒（F-2；CATEGORY_OTHER 由預覽依最終分類決定）
    const validPrices = variants.flatMap((v) => (v.price === null ? [] : [v.price]));
    const minPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;
    if (TOP_UP_KEYWORDS.some((w) => title.includes(w)) || (minPrice !== null && minPrice < TOP_UP_PRICE_BELOW)) {
      warnings.push(issue('LOOKS_LIKE_TOP_UP', '看起來像補差額／補價的商品，請確認是否要匯入'));
    }
    if (codePointLength(description) > DESCRIPTION_EDITOR_LIMIT) {
      warnings.push(issue('DESCRIPTION_OVER_EDITOR_LIMIT',
        `描述超過 ${DESCRIPTION_EDITOR_LIMIT.toLocaleString('en-US')} 字，會完整匯入，但日後在編輯頁無法再加長`));
    }

    const stocks = variants.map((v) => v.stock);
    const soldOut = variants.length > 0 && stocks.every((s) => s === 0);

    return {
      sourceProductId: id,
      title, description,
      shopeeCategory,
      shopeeCategoryId: parseShopeeCategoryId(shopeeCategory),
      mappedCategoryId: mapShopeeCategory(shopeeCategory),
      images: images.slice(0, MAX_IMAGES_PER_PRODUCT),
      hasCover,
      variants,
      presentIn,
      errors,
      warnings,
      soldOut,
    };
  });
}
