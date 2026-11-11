import type { Product, Variant } from '../../types';

// 商品資料防禦性解析：資料庫回來的列一律當成不可信的輸入。
// 形狀不符的商品不進 store，進到 store 的 Product 一定符合 types.ts。

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** 規格陣列：非空、每個元素有 id／name／price／stock 且型別正確，否則回 null。選填欄位型別不對就略過該欄，白名單以外的欄位不帶入 */
export function parseVariants(raw: unknown): Variant[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Variant[] = [];
  for (const el of raw) {
    if (!isRecord(el)) return null;
    const { id, name, price, stock, originalPrice, sourceId, image } = el;
    if (!isStr(id) || id === '' || !isStr(name) || !isNum(price) || !isNum(stock)) return null;
    const v: Variant = { id, name, price, stock };
    if (isNum(originalPrice)) v.originalPrice = originalPrice;
    if (isStr(sourceId)) v.sourceId = sourceId;
    if (isStr(image)) v.image = image;
    out.push(v);
  }
  return out;
}

/** 圖片網址陣列：每個元素都要是字串（可為空陣列），否則回 null */
export function parseImages(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.every(isStr)) return null;
  return [...raw];
}

/** 資料庫的一列 → Product；形狀不符回 null */
export function parseProductRow(raw: unknown): Product | null {
  if (!isRecord(raw)) return null;
  const { id, shop_id, title, description, category_id, status } = raw;
  if (!isStr(id) || !isStr(shop_id) || !isStr(title) || !isStr(description) || !isStr(category_id)) return null;
  if (status !== 'active' && status !== 'hidden') return null;
  const images = parseImages(raw.images);
  const variants = parseVariants(raw.variants);
  if (!images || !variants) return null;
  const rating = Number(raw.rating);
  return {
    id, shopId: shop_id, title, description,
    categoryId: category_id as Product['categoryId'],
    images, variants,
    sold: isNum(raw.sold) ? raw.sold : 0,
    rating: Number.isFinite(rating) ? rating : 0,
    location: isStr(raw.location) ? raw.location : '',
    freeShipping: raw.free_shipping === true,
    status,
    createdAt: isStr(raw.created_at) ? raw.created_at : '',
  };
}

/** 批次解析；形狀不符的略過並警告一筆（只含商品 id，不印整列） */
export function parseProductRows(rows: unknown[], warn: (...args: unknown[]) => void = console.warn): Product[] {
  const out: Product[] = [];
  for (const r of rows) {
    const p = parseProductRow(r);
    if (p) out.push(p);
    else warn('商品資料形狀不符，已略過', isRecord(r) && isStr(r.id) ? r.id : '(無 id)');
  }
  return out;
}
