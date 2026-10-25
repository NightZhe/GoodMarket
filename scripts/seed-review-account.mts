// 建立（或重建）App 審查用的示範賣家帳號：1 個 Email 帳號、1 家示範商店、3 件示範商品（全部下架）。
//
// 用法（本機）：
//   SUPABASE_URL=http://127.0.0.1:<port> SUPABASE_SERVICE_ROLE_KEY=<key> \
//   REVIEW_EMAIL=<email> REVIEW_PASSWORD=<password> \
//   node --experimental-strip-types scripts/seed-review-account.mts [--reset-password]
//
// 用法（正式站，只能由使用者在自己的終端機執行，key 與密碼用 read -rs 輸入，不經 agent）：
//   read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY
//   read -rs REVIEW_PASSWORD;           export REVIEW_PASSWORD
//   export SUPABASE_URL=https://<project-ref>.supabase.co REVIEW_EMAIL=<email>
//   node --experimental-strip-types scripts/seed-review-account.mts --remote
//   （執行後會要求手動輸入專案 ref 才會繼續；用完 unset 這幾個變數）
//
// 環境變數（缺任何一個或空字串 → 印用法、exit 2）：
//   SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、REVIEW_EMAIL、REVIEW_PASSWORD
//
// 旗標：
//   --remote          允許連到非本機網址（只接受 https，且必須在互動終端機輸入專案 ref 確認）
//   --reset-password  帳號已存在時，把密碼更新成 REVIEW_PASSWORD（預設沿用舊密碼，不動）
//
// 結束碼：0 成功；1 執行中止或失敗（含「帳號有門號／非 Email 身分」、商品 id 被別店使用）；2 用法或設定錯誤。
//
// 安全規則：
//   - 沒有預設帳密；密碼與 service role key 只從環境變數讀，不寫檔、不印出（所有輸出都會再過一次遮罩）。
//   - 預設只允許 127.0.0.1／localhost。
//   - 帳號有門號或有 Email 以外的登入方式 → 中止（避免把真人帳號變成示範帳號）。
//   - 冪等：重跑任意次，帳號 1、店 1、商品 3；每次重跑會把 3 件商品改回 hidden（等於審查後的下架動作）。
//   - 帳號被刪除後（審查員送出刪除申請並處理完）重跑本腳本即可重建；帳號識別碼會變，帳密不變。
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';

// ---------- 設定 ----------

const SHOP_NAME = '好物集示範商店';
const SHOP_DESCRIPTION = '這是提供 App 審查使用的示範商店，商品不對外販售。';
const SHOP_LOCATION = '臺北市';
const SHOP_AVATAR = '🛍️';

// 售價上限 499,999、庫存上限 999,999（src/lib/products/variants.ts）；標題 5–60 字、店名 2–20 字（DB check）
const PRICE_MAX = 499_999;
const STOCK_MAX = 999_999;

const art = (emoji: string, from: string, to: string) => `art:${emoji}:${from}:${to}`;

interface DemoVariant { id: string; name: string; price: number; originalPrice?: number; stock: number }
interface DemoProduct {
  key: string; // 產生固定 id 用，改了 id 就變，別改
  title: string;
  description: string;
  categoryId: string;
  images: string[];
  variants: DemoVariant[];
  freeShipping: boolean;
}

const DEMO_PRODUCTS: DemoProduct[] = [
  { // 多規格
    key: 'review-demo-product-1',
    title: '【示範】藍牙無線耳機（僅供審查）',
    description: '這是 App 審查用的示範商品，不對外販售。\n多規格範例：三種顏色，各自庫存。',
    categoryId: '3c',
    images: [art('🎧', '#dbeafe', '#93c5fd')],
    variants: [
      { id: 'v1', name: '曜石黑', price: 1290, originalPrice: 1990, stock: 30 },
      { id: 'v2', name: '月光白', price: 1290, originalPrice: 1990, stock: 20 },
      { id: 'v3', name: '霧藍', price: 1390, originalPrice: 2090, stock: 10 },
    ],
    freeShipping: true,
  },
  { // 單規格
    key: 'review-demo-product-2',
    title: '【示範】陶瓷手沖咖啡濾杯組（僅供審查）',
    description: '這是 App 審查用的示範商品，不對外販售。\n單規格範例：只有一種款式。',
    categoryId: 'home',
    images: [art('☕', '#fef3c7', '#fcd34d')],
    variants: [{ id: 'v1', name: '標準款', price: 480, stock: 50 }],
    freeShipping: false,
  },
  { // 多規格
    key: 'review-demo-product-3',
    title: '【示範】台灣伴手禮餅乾禮盒（僅供審查）',
    description: '這是 App 審查用的示範商品，不對外販售。\n多規格範例：兩種口味。',
    categoryId: 'food',
    images: [art('🍪', '#ffedd5', '#fdba74')],
    variants: [
      { id: 'v1', name: '原味', price: 360, stock: 40 },
      { id: 'v2', name: '抹茶', price: 380, stock: 25 },
    ],
    freeShipping: false,
  },
];

// 與 scripts/gen-seed-sql.mts 相同的穩定 UUID 做法：同一個字串永遠得到同一個 id
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

// ---------- 輸出（一律過遮罩，防止密碼或 key 因任何原因漏進 log） ----------

const secrets: string[] = [];
const scrub = (s: string) => secrets.reduce((acc, x) => (x ? acc.split(x).join('***') : acc), s);
const say = (s = '') => console.log(scrub(s));
const warn = (s = '') => console.error(scrub(s));

const USAGE = `用法：
  SUPABASE_URL=<網址> SUPABASE_SERVICE_ROLE_KEY=<key> REVIEW_EMAIL=<email> REVIEW_PASSWORD=<密碼> \\
  node --experimental-strip-types scripts/seed-review-account.mts [--remote] [--reset-password]

必要的環境變數：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、REVIEW_EMAIL、REVIEW_PASSWORD
  --remote          連到非本機（只接受 https；之後要手動輸入專案 ref 確認）
  --reset-password  帳號已存在時更新密碼（預設不動）
預設只允許 127.0.0.1／localhost。詳見檔頭註解。`;

const die = (code: number, msg: string, showUsage = false): never => {
  warn(msg);
  if (showUsage) warn('\n' + USAGE);
  process.exit(code);
};

const maskEmail = (e: string) => {
  const [local, domain = ''] = e.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

// ---------- 參數與環境檢查（任何網路動作之前） ----------

const flags = new Set(process.argv.slice(2));
for (const f of flags) {
  if (f !== '--remote' && f !== '--reset-password') die(2, `不認得的參數：${f}`, true);
}
const remote = flags.has('--remote');
const resetPassword = flags.has('--reset-password');

const env = (k: string) => (process.env[k] ?? '').trim();
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REVIEW_EMAIL', 'REVIEW_PASSWORD'].filter(k => !env(k));
if (missing.length) die(2, `缺少環境變數：${missing.join('、')}`, true);

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const EMAIL = env('REVIEW_EMAIL').toLowerCase();
const PASSWORD = process.env.REVIEW_PASSWORD as string; // 密碼不 trim：前後空白也可能是密碼的一部分
secrets.push(PASSWORD, SERVICE_KEY);

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(EMAIL)) die(2, 'REVIEW_EMAIL 不是有效的 Email 格式', true);

let url: URL;
try { url = new URL(SUPABASE_URL); } catch { url = die(2, 'SUPABASE_URL 不是有效網址', true); }
const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';

if (!isLocal) {
  if (!remote) {
    die(2, `拒絕：${url.host} 不是本機（127.0.0.1／localhost）。要對遠端執行請加 --remote（並在終端機手動確認專案 ref）。`);
  }
  if (url.protocol !== 'https:') die(2, '拒絕：--remote 只接受 https 網址（service role key 不走明文連線）。');
  if (!process.stdin.isTTY) die(2, '拒絕：--remote 需要互動式終端機輸入專案 ref 確認，不能用管線或背景執行。');
  // 專案 ref：<ref>.supabase.co 取第一段，其他網域（自訂網域）要輸入完整主機名稱
  const expected = url.hostname.endsWith('.supabase.co') ? url.hostname.split('.')[0] : url.hostname;
  warn(`你正要對遠端專案寫入示範帳號：${url.host}`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let typed = '';
  try {
    typed = (await rl.question('請輸入專案 ref 確認（輸入錯誤即中止）：')).trim();
  } catch {
    die(2, '\n沒有收到專案 ref（輸入被中斷），已中止，沒有做任何事。');
  } finally {
    rl.close();
  }
  if (typed !== expected) die(2, '專案 ref 不符，已中止，沒有做任何事。');
}

// ---------- 主流程 ----------

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const fail = (what: string, err: { message?: string; status?: number; code?: string } | null): never =>
  die(1, `失敗：${what}（${[err?.status, err?.code, err?.message].filter(Boolean).join(' ')}）`);

type AuthUser = {
  id: string; email?: string; phone?: string; email_confirmed_at?: string | null; is_anonymous?: boolean;
  app_metadata?: { provider?: string; providers?: string[] };
  identities?: { provider: string }[] | null;
};

async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const perPage = 1000;
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail('讀取使用者清單', error);
    const users = data.users as AuthUser[];
    const hit = users.find(u => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
}

/** 有門號、匿名、或有 Email 以外的登入方式 → 回傳原因；乾淨的 Email 帳號回 null */
function notDemoSafeReason(u: AuthUser): string | null {
  if (u.phone) return '帳號有門號';
  if (u.is_anonymous) return '帳號是匿名帳號';
  const providers = new Set<string>([
    ...(u.app_metadata?.providers ?? []),
    ...(u.app_metadata?.provider ? [u.app_metadata.provider] : []),
    ...(u.identities ?? []).map(i => i.provider),
  ]);
  const other = [...providers].filter(p => p !== 'email');
  if (other.length) return `帳號有 Email 以外的登入方式（${other.join('、')}）`;
  return null;
}

// 1. 帳號
let user = await findUserByEmail(EMAIL);
let accountAction: string;
if (user) {
  const reason = notDemoSafeReason(user);
  if (reason) die(1, `中止：${maskEmail(EMAIL)} ${reason}，這看起來是真人帳號，不會把它變成示範帳號。`);
  const patch: { password?: string; email_confirm?: boolean } = {};
  if (resetPassword) patch.password = PASSWORD;
  if (!user.email_confirmed_at) patch.email_confirm = true;
  if (Object.keys(patch).length) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, patch);
    if (error) fail('更新既有帳號', error);
  }
  accountAction = `沿用既有帳號${resetPassword ? '，密碼已更新' : '，密碼未動'}${patch.email_confirm ? '，已補上 Email 確認' : ''}`;
} else {
  const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error || !data.user) fail('建立帳號', error);
  user = data.user as AuthUser;
  accountAction = '新建帳號';
}
const userId = (user as AuthUser).id;

// 2. 店（以 owner_id 找）
const { data: shopRows, error: shopErr } = await supabase.from('shops').select('id, name').eq('owner_id', userId);
if (shopErr) fail('讀取商店', shopErr);
let shopId: string;
let shopAction: string;
if (shopRows && shopRows.length > 0) {
  shopId = shopRows[0].id as string;
  const { error } = await supabase.from('shops').update({ name: SHOP_NAME, description: SHOP_DESCRIPTION }).eq('id', shopId);
  if (error) fail('更新商店', error);
  shopAction = '沿用並更新名稱與說明';
} else {
  const { data, error } = await supabase.from('shops')
    .insert({ owner_id: userId, name: SHOP_NAME, avatar: SHOP_AVATAR, description: SHOP_DESCRIPTION, location: SHOP_LOCATION })
    .select('id').single();
  if (error || !data) fail('建立商店', error);
  shopId = (data as { id: string }).id;
  shopAction = '新建';
}

// 3. 商品：id 固定；已被其他店使用就中止（寫入前先檢查）
for (const p of DEMO_PRODUCTS) {
  for (const v of p.variants) {
    if (!(v.price > 0 && v.price <= PRICE_MAX) || !(v.stock >= 0 && v.stock <= STOCK_MAX)) {
      die(1, `內建資料錯誤：${p.key} 的價格或庫存超出上限`);
    }
  }
}
const ids = DEMO_PRODUCTS.map(p => uuidOf(p.key));
const { data: existing, error: exErr } = await supabase.from('products').select('id, shop_id').in('id', ids);
if (exErr) fail('讀取既有商品', exErr);
const foreign = (existing ?? []).filter(r => r.shop_id !== shopId);
if (foreign.length) die(1, `中止：商品 id ${foreign.map(r => r.id).join('、')} 已被其他商店使用，不覆寫。`);

const { error: upErr } = await supabase.from('products').upsert(
  DEMO_PRODUCTS.map(p => ({
    id: uuidOf(p.key),
    shop_id: shopId,
    title: p.title,
    description: p.description,
    category_id: p.categoryId,
    images: p.images,
    variants: p.variants,
    location: SHOP_LOCATION,
    free_shipping: p.freeShipping,
    status: 'hidden', // N11：示範商品預設下架，前台看不到
  })),
  { onConflict: 'id' },
);
if (upErr) fail('寫入商品', upErr);

// 4. 讀回驗證（印的是資料庫實際內容，不是我們以為寫進去的）
const { data: back, error: backErr } = await supabase.from('products').select('id, title, status').in('id', ids);
if (backErr) fail('讀回商品', backErr);
const { count: shopCount } = await supabase.from('shops').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
const { count: shopProductCount } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shopId);

say('完成。');
say(`帳號識別碼（auth user id）：${userId}（${accountAction}）`);
say(`Email（遮罩）：${maskEmail(EMAIL)}`);
say(`商店 id：${shopId}（${shopAction}；此帳號名下商店數 ${shopCount ?? '?'}）`);
say(`商品（店內商品總數 ${shopProductCount ?? '?'}）：`);
for (const p of DEMO_PRODUCTS) {
  const row = (back ?? []).find(r => r.id === uuidOf(p.key));
  say(`  ${uuidOf(p.key)}  狀態 ${row?.status ?? '（讀不到）'}  ${p.title}`);
}
if ((back ?? []).length !== DEMO_PRODUCTS.length || (back ?? []).some(r => r.status !== 'hidden')) {
  die(1, '警告：讀回的商品數量或狀態不符預期，請檢查。');
}
