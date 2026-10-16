import type { CategoryId, ImportFileKind } from '../../types';

// ───────── 讀檔 ─────────

export interface SheetRow {
  /** 試算表上的列號（1 起算），失敗原因檔與錯誤訊息用 */
  rowNumber: number;
  values: string[];
}

export interface ParsedSheet {
  kind: ImportFileKind;
  fileName: string;
  /** 第 2 列第 4 格（蝦皮店家 ID） */
  externalShopId: string;
  /** 第 1–6 列原樣（失敗原因檔要原樣保留） */
  headerRows: string[][];
  /** 第 1 列機器欄位鍵，依欄位順序 */
  columnKeys: string[];
  columnIndex: ReadonlyMap<string, number>;
  /** 第 7 列起、扣掉全空白列 */
  rows: SheetRow[];
  rowCount: number;
  /** 不重複商品 ID，依出現順序 */
  productIds: string[];
  productCount: number;
  /** 有內容但商品 ID 空白的列號（無法歸屬任何商品，不會被匯入） */
  rowsWithoutProductId: number[];
  /** 缺少的必要欄位（E-1.6） */
  missingColumns: { key: string; label: string }[];
}

export type FileIntake =
  | { ok: true; fileName: string; sheet: ParsedSheet }
  | { ok: false; fileName: string; reason: 'FILE_TOO_LARGE' | 'NOT_SHOPEE_FILE' | 'DTS_FILE' };

// ───────── 檔案組合檢查（步驟 1）─────────

export type FileSetIssue =
  | { code: 'MISSING_KIND'; kinds: ImportFileKind[]; message: string }
  | { code: 'DUPLICATE_KIND'; kind: ImportFileKind; fileNames: string[]; message: string }
  | { code: 'NOT_SHOPEE_FILE'; fileName: string; message: string }
  | { code: 'DTS_FILE'; fileName: string; message: string }
  | { code: 'FILE_TOO_LARGE'; fileName: string; message: string }
  | { code: 'SHOP_MISMATCH'; shopIds: string[]; message: string }
  | {
      code: 'MISSING_COLUMNS'; kind: ImportFileKind; fileName: string;
      columns: { key: string; label: string }[]; message: string;
    }
  | { code: 'TOO_MANY_PRODUCTS'; total: number; limit: number; message: string };

export interface SheetSet {
  basic: ParsedSheet;
  sales: ParsedSheet;
  media: ParsedSheet;
}

export interface FileSetAnalysis {
  issues: FileSetIssue[];
  /** 三檔齊全且沒有任何阻擋錯誤才為 true（F-1.7） */
  canProceed: boolean;
  /** 三檔各剛好一個時才有值 */
  sheets: SheetSet | null;
  /** 三檔商品 ID 聯集的件數；三檔未齊全時為 null */
  totalProducts: number | null;
  externalShopId: string | null;
}

// ───────── 轉換結果 ─────────

export type ProductErrorCode =
  | 'MISSING_IN_FILE' | 'DUPLICATE_ROW' | 'TITLE_LENGTH' | 'MISSING_COVER'
  | 'PRICE_INVALID' | 'STOCK_INVALID' | 'VARIANT_NAME_DUPLICATE';

export type ProductWarningCode =
  | 'CATEGORY_OTHER' | 'LOOKS_LIKE_TOP_UP' | 'DESCRIPTION_OVER_EDITOR_LIMIT';

export interface ProductIssue<C extends string = string> {
  code: C;
  /** 中文原因（F-6.4 範本；失敗原因檔直接用） */
  message: string;
}

/** 圖片的位置：'cover'、'image:1'…'image:8'（商品圖片 n）、'option:〈選項名稱〉' */
export interface SourceImage {
  slot: string;
  sourceUrl: string;
}

export interface ParsedVariant {
  sourceVariantId: string;
  rawName: string;
  /** 攤平後的名稱（F-5） */
  name: string;
  rawPrice: string;
  rawStock: string;
  /** 不合法時為 null（同時產生 PRICE_INVALID／STOCK_INVALID） */
  price: number | null;
  stock: number | null;
  /** 對到且有圖的第一層選項圖（F-5.2）；對不到或沒圖為 null */
  image: SourceImage | null;
}

export interface ParsedProduct {
  sourceProductId: string;
  title: string;
  description: string;
  /** media 的原始分類字串 */
  shopeeCategory: string;
  shopeeCategoryId: string | null;
  /** 對照表結果（尚未套用賣家在預覽頁的修改） */
  mappedCategoryId: CategoryId;
  /** 主圖在前，最多 9 張，只含非空者 */
  images: SourceImage[];
  hasCover: boolean;
  variants: ParsedVariant[];
  presentIn: Record<ImportFileKind, boolean>;
  errors: ProductIssue<ProductErrorCode>[];
  /** 與分類無關的提醒（LOOKS_LIKE_TOP_UP、DESCRIPTION_OVER_EDITOR_LIMIT）；CATEGORY_OTHER 由預覽依最終分類加上 */
  warnings: ProductIssue<ProductWarningCode>[];
  /** 該商品所有規格庫存皆為 0（F-5.4）；沒有規格或庫存不合法時為 false */
  soldOut: boolean;
}

// ───────── 預覽 ─────────

export interface PreviewOptions {
  skipSoldOut: boolean;
  allHidden: boolean;
}

export type PreviewAction = 'create' | 'update' | 'error' | 'skip';

export interface PreviewRow {
  sourceProductId: string;
  title: string;
  coverUrl: string | null;
  categoryId: CategoryId;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  soldOut: boolean;
  action: PreviewAction;
  /** 此商品已存在本店（get_import_index 有它） */
  existing: boolean;
  /** 匯入後狀態；error／skip 為 null。更新商品是依 F-5.6 推算（不知道手動規格） */
  afterStatus: 'active' | 'hidden' | null;
  errors: ProductIssue<ProductErrorCode>[];
  warnings: ProductIssue<ProductWarningCode>[];
}

export interface PreviewCounts {
  /** 檔案商品數；恆等於 created + updated + errors + skipped */
  total: number;
  created: number;
  updated: number;
  errors: number;
  skipped: number;
  /** 需要注意：有提醒、且會被匯入（新增或更新）的件數 */
  warnings: number;
  /** 報告的「有問題」＝ errors + warnings（同一件只算一次） */
  problems: number;
  warningsByCode: Record<ProductWarningCode, number>;
}

export interface PreviewResult {
  rows: PreviewRow[];
  counts: PreviewCounts;
  /** created + updated > 0 才能開始匯入（F-2.5） */
  canStart: boolean;
}

// ───────── ImportItem 草稿（圖片只有來源網址，url 由圖片轉存填）─────────

export interface DraftImage {
  sourceUrl: string;
  slot: string;
}

export interface ImportItemDraft {
  sourceProductId: string;
  title: string;
  description: string;
  categoryId: CategoryId;
  status: 'active' | 'hidden';
  images: DraftImage[];
  variants: {
    sourceVariantId: string;
    name: string;
    price: number;
    stock: number;
    image: DraftImage | null;
  }[];
}
