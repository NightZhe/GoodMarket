// 由 src/data/seed.ts 產生 supabase/seed.sql（示範商店與商品）
// 用法：node --experimental-strip-types scripts/gen-seed-sql.mts > supabase/seed.sql
import { SEED_SHOPS, SEED_PRODUCTS } from '../src/data/seed.ts';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

// 用固定字串產生穩定 UUID，重跑不會長出重複資料
const uuidOf = (key: string) => {
  let h = 0x811c9dc5;
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    h ^= key.charCodeAt(i % key.length) + i;
    h = Math.imul(h, 0x01000193) >>> 0;
    hex.push(((h >>> (i % 24)) & 0xf).toString(16));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
};

const daysAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 86400000);

const out: string[] = [
  '-- 示範資料（由 scripts/gen-seed-sql.mts 依 src/data/seed.ts 產生，請勿手改）',
  '-- 平台示範商店的 owner_id 為 null，沒有任何帳號能編輯它們。',
  '',
  'insert into public.shops (id, owner_id, name, avatar, description, location, rating) values',
  SEED_SHOPS.map(s =>
    `  (${q(uuidOf(s.id))}, null, ${q(s.name)}, ${q(s.avatar)}, ${q(s.description)}, ${q(s.location)}, ${s.rating})`,
  ).join(',\n') + '\non conflict (id) do nothing;',
  '',
  'insert into public.products (id, shop_id, title, description, category_id, images, variants, sold, rating, location, free_shipping, status, created_at) values',
  SEED_PRODUCTS.map(p =>
    `  (${q(uuidOf(p.id))}, ${q(uuidOf(p.shopId))}, ${q(p.title)}, ${q(p.description)}, ${q(p.categoryId)}, ` +
    `${j(p.images)}, ${j(p.variants)}, ${p.sold}, ${p.rating}, ${q(p.location)}, ` +
    `${p.freeShipping}, ${q(p.status)}, now() - interval '${daysAgo(p.createdAt)} days')`,
  ).join(',\n') + '\non conflict (id) do nothing;',
];

console.log(out.join('\n'));
