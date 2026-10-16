// 單元測試用的「自編蝦皮匯出檔」：全部是編造的假資料，不含任何真實店家內容（repo 是公開的）。
import * as XLSX from 'xlsx';
import {
  EXTRA_IMAGE_SLOTS, HEADER_ROW_COUNT, OPTION_SLOTS, imageKey, optionImageKey, optionNameKey,
} from './constants';

export interface FakeVariant { id: string; name: string; price: string | number; stock: string | number }
export interface FakeProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  cover?: string;
  images?: string[];
  options?: { name: string; image?: string }[];
  variants: FakeVariant[];
}

export type Grid = string[][];
export interface FakeGrids { basic: Grid; sales: Grid; media: Grid }

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const BASIC_KEYS = ['et_title_product_id', 'et_title_parent_sku', 'et_title_product_name', 'et_title_product_description', 'et_title_reason'];
const SALES_KEYS = [
  'et_title_product_id', 'et_title_product_name', 'et_title_variation_id', 'et_title_variation_name', 'et_title_parent_sku',
  'et_title_variation_sku', 'et_title_variation_price', 'ps_gtin_code', 'et_title_variation_stock', 'ps_minimum_purchase_quantity',
  'et_title_reason',
];
const MEDIA_KEYS = [
  'et_title_product_id', 'et_title_parent_sku', 'et_title_product_name', 'et_title_product_category', 'ps_item_cover_image',
  ...range(EXTRA_IMAGE_SLOTS).map(imageKey), 'ps_new_size_chart', 'et_title_size_chart', 'et_title_variation_1',
  ...range(OPTION_SLOTS).flatMap((k) => [optionNameKey(k), optionImageKey(k)]), 'et_title_reason',
];

function header(type: string, keys: string[], shopId: string): Grid {
  const blank = () => keys.map(() => '');
  const r2 = blank();
  [r2[0], r2[1], r2[2], r2[3]] = [type, 'fakehash', '0', shopId];
  const r3 = keys.map((k) => `zh:${k}`);
  return [keys, r2, r3, blank(), blank(), blank()];
}

export function fakeGrids(products: FakeProduct[], shopId = '1234567'): FakeGrids {
  const basic = header('basic_info', BASIC_KEYS, shopId);
  const sales = header('sales_info', SALES_KEYS, shopId);
  const media = header('media_info', MEDIA_KEYS, shopId);
  const idx = (keys: string[], k: string) => keys.indexOf(k);

  for (const p of products) {
    const b = BASIC_KEYS.map(() => '');
    b[idx(BASIC_KEYS, 'et_title_product_id')] = p.id;
    b[idx(BASIC_KEYS, 'et_title_product_name')] = p.name;
    b[idx(BASIC_KEYS, 'et_title_product_description')] = p.description ?? '';
    basic.push(b);

    for (const v of p.variants) {
      const s = SALES_KEYS.map(() => '');
      s[idx(SALES_KEYS, 'et_title_product_id')] = p.id;
      s[idx(SALES_KEYS, 'et_title_variation_id')] = v.id;
      s[idx(SALES_KEYS, 'et_title_variation_name')] = v.name;
      s[idx(SALES_KEYS, 'et_title_variation_price')] = String(v.price);
      s[idx(SALES_KEYS, 'et_title_variation_stock')] = String(v.stock);
      sales.push(s);
    }

    const m = MEDIA_KEYS.map(() => '');
    m[idx(MEDIA_KEYS, 'et_title_product_id')] = p.id;
    m[idx(MEDIA_KEYS, 'et_title_product_category')] = p.category ?? '101087 - Gaming & Consoles/Video Games/Switch';
    m[idx(MEDIA_KEYS, 'ps_item_cover_image')] = p.cover ?? `https://img.test/${p.id}/cover`;
    (p.images ?? []).forEach((u, i) => { m[idx(MEDIA_KEYS, imageKey(i + 1))] = u; });
    (p.options ?? []).forEach((o, i) => {
      m[idx(MEDIA_KEYS, optionNameKey(i + 1))] = o.name;
      m[idx(MEDIA_KEYS, optionImageKey(i + 1))] = o.image ?? '';
    });
    media.push(m);
  }
  return { basic, sales, media };
}

export function toXlsx(grid: ReadonlyArray<ReadonlyArray<string | number>>): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(grid.map((r) => r.map((v) => (v === '' ? null : v))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export const DATA_START = HEADER_ROW_COUNT; // grid 中第一筆資料列的索引

/** 三筆編造商品：多規格、單規格（空白名稱）、已售完 */
export const SAMPLE: FakeProduct[] = [
  {
    id: '1001', name: '假商品一號 多規格', description: '第一行\r\n第二行 😀\r\n', images: ['https://img.test/1001/1', 'https://img.test/1001/2'],
    options: [{ name: '紅', image: 'https://img.test/1001/opt-red' }, { name: '藍' }],
    variants: [
      { id: '5001', name: '紅,大', price: 100, stock: 3 },
      { id: '5002', name: '紅,小', price: 90, stock: 0 },
      { id: '5003', name: '藍,大', price: 120, stock: 5 },
    ],
  },
  { id: '1002', name: '假商品二號 單規格', variants: [{ id: '5004', name: '', price: 50, stock: 7 }], category: '101082 - Gaming & Consoles/Video Games/Playstation' },
  { id: '1003', name: '假商品三號 售完', variants: [{ id: '5005', name: '標準', price: 300, stock: 0 }], category: '999999 - Unknown' },
];

export function sampleBytes(shopId = '1234567') {
  const g = fakeGrids(SAMPLE, shopId);
  return { basic: toXlsx(g.basic), sales: toXlsx(g.sales), media: toXlsx(g.media), grids: g };
}
