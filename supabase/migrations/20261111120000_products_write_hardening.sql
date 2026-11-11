-- products 寫入欄位收斂與資料形狀檢查
--
-- 內容（全部可重複執行）：
--   1. 權限：收回 anon／authenticated 對 products 的全部權限，再依需要重新授與
--        · select：整表（anon、authenticated；RLS policy 不動）
--        · insert／update：只開九欄 shop_id, title, description, category_id, images, variants, free_shipping, location, status（authenticated）
--        · delete：authenticated（仍受 RLS：只能刪自己店的商品）
--        · service_role 不動。id, sold, rating, created_at, auto_hidden, source, source_product_id 只由資料庫端函式與 service_role 寫入
--   2. 資料形狀檢查：三個 immutable 函式＋五條 CHECK
--        · products_variants_valid(jsonb)：陣列、1–200 個元素、每個元素是物件、key 限定 id／name／price／stock／originalPrice／sourceId／image，
--          各欄型別與範圍固定，同一商品內 id 不重複
--        · products_images_valid(jsonb)：陣列、0–9 個元素、每個元素是 1–2048 字、以 https:// http:// 或 art: 開頭的字串（取代 products_images_max_check）
--        · description ≤ 10,000 字、location ≤ 20 字、category_id ≤ 30 字
--      所有寫入者（含 SECURITY DEFINER 函式）都受 CHECK 約束，所以上限取「所有合法寫入者中最寬的」。
--   3. 約束先以 NOT VALID 加上（立刻管住新寫入與被修改的列），再嘗試 VALIDATE；
--      VALIDATE 失敗（既有列不合）只發 WARNING，不讓整支回滾，權限收斂照樣生效。
--      哪一條還沒 validated：supabase/ops/products-write-hardening/verify.sql；哪些列不合：同目錄 precheck.sql。
--
-- 套用順序：這支 migration 會「收回」權限。前端（含本檔之前的版本）只寫上面九欄，不依賴被收回的權限。
-- 還原：supabase/ops/products-write-hardening/rollback.sql。
-- 整個檔案包在一個交易裡；結構性的步驟失敗就整個回滾，只有 VALIDATE 例外。

begin;

-- 拿不到鎖就快速失敗（整個回滾），不要排在線上流量後面卡住
set local lock_timeout = '10s';

-- ──────────────────────────── 檢查函式 ────────────────────────────
-- immutable、search_path 固定、對任何 jsonb 輸入（含 null、純量、巢狀、超大數字、非數字字串）都只回 boolean，不丟例外。
-- 型別判斷一律用 CASE 包住取值，避免依賴 SQL 的求值順序。

-- 是 JSON 數字、為整數、落在 [lo, hi]
create or replace function public.products_jsonb_int_between(p_val jsonb, p_lo numeric, p_hi numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_val is not null and jsonb_typeof(p_val) = 'number'
      then (p_val #>> '{}')::numeric = trunc((p_val #>> '{}')::numeric)
           and (p_val #>> '{}')::numeric between p_lo and p_hi
    else false
  end;
$$;

-- 是 JSON 字串，長度（字元數）落在 [lo, hi]
create or replace function public.products_jsonb_text_len(p_val jsonb, p_lo integer, p_hi integer)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_val is not null and jsonb_typeof(p_val) = 'string'
      then char_length(p_val #>> '{}') between p_lo and p_hi
    else false
  end;
$$;

create or replace function public.products_variants_valid(p_variants jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  n integer;
  e jsonb;
begin
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    return false;
  end if;
  n := jsonb_array_length(p_variants);
  if n < 1 or n > 200 then
    return false;
  end if;
  for e in select value from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(e) <> 'object' then
      return false;
    end if;
    -- key 白名單
    if exists (select 1 from jsonb_object_keys(e) k
                where k not in ('id', 'name', 'price', 'stock', 'originalPrice', 'sourceId', 'image')) then
      return false;
    end if;
    -- 必填：id、name、price、stock
    if not public.products_jsonb_text_len(e->'id', 1, 64) then return false; end if;
    if not public.products_jsonb_text_len(e->'name', 1, 200) or btrim(e->>'name') = '' then return false; end if;
    if not public.products_jsonb_int_between(e->'price', 1, 499999) then return false; end if;
    if not public.products_jsonb_int_between(e->'stock', 0, 2147483647) then return false; end if;
    -- 選填：有這個 key 就必須合格（不接受 null 值）
    if e ? 'originalPrice' and not public.products_jsonb_int_between(e->'originalPrice', 0, 499999) then return false; end if;
    if e ? 'sourceId' and not public.products_jsonb_text_len(e->'sourceId', 1, 32) then return false; end if;
    if e ? 'image' and not public.products_jsonb_text_len(e->'image', 1, 2048) then return false; end if;
  end loop;
  -- 同一商品內 id 不重複
  return (select count(distinct x->>'id') from jsonb_array_elements(p_variants) x) = n;
end $$;

create or replace function public.products_images_valid(p_images jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_images) > 9 then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_array_elements(p_images) x
     where not coalesce(
             public.products_jsonb_text_len(x, 1, 2048)
             and (x #>> '{}') ~ '^(https://|http://|art:)',
             false));
end $$;

-- ──────────────────────────── 權限 ────────────────────────────
-- 先整個收回再重新授與：重跑時結果固定

revoke all on table public.products from anon, authenticated;

grant select on table public.products to anon, authenticated;

grant insert (shop_id, title, description, category_id, images, variants, free_shipping, location, status)
  on table public.products to authenticated;
grant update (shop_id, title, description, category_id, images, variants, free_shipping, location, status)
  on table public.products to authenticated;
grant delete on table public.products to authenticated;

-- ──────────────────────────── 約束（NOT VALID） ────────────────────────────

alter table public.products drop constraint if exists products_images_max_check;
alter table public.products drop constraint if exists products_images_shape_check;
alter table public.products drop constraint if exists products_variants_shape_check;
alter table public.products drop constraint if exists products_description_len_check;
alter table public.products drop constraint if exists products_location_len_check;
alter table public.products drop constraint if exists products_category_len_check;

alter table public.products add constraint products_images_shape_check
  check (public.products_images_valid(images)) not valid;
alter table public.products add constraint products_variants_shape_check
  check (public.products_variants_valid(variants)) not valid;
alter table public.products add constraint products_description_len_check
  check (char_length(description) <= 10000) not valid;
alter table public.products add constraint products_location_len_check
  check (char_length(location) <= 20) not valid;
alter table public.products add constraint products_category_len_check
  check (char_length(category_id) <= 30) not valid;

-- ──────────────────────────── 嘗試 VALIDATE（失敗只發 WARNING） ────────────────────────────
-- 每條各自一個子交易：某條失敗不影響其他條，也不回滾上面的權限與約束

do $$
declare c text;
begin
  foreach c in array array['products_images_shape_check', 'products_variants_shape_check',
                           'products_description_len_check', 'products_location_len_check',
                           'products_category_len_check'] loop
    begin
      execute format('alter table public.products validate constraint %I', c);
    exception when check_violation then
      raise warning '約束 % 未能 VALIDATE：既有資料有不合的列（新寫入仍受檢查）。用 supabase/ops/products-write-hardening/precheck.sql 找出那些列，處理後重跑本檔', c;
    end;
  end loop;
end $$;

-- ──────────────────────────── 自我檢查（結構性；失敗整個回滾） ────────────────────────────

do $$
declare
  c text;
  f text;
  col text;
  allowed constant text[] := array['shop_id', 'title', 'description', 'category_id', 'images', 'variants',
                                   'free_shipping', 'location', 'status'];
  denied constant text[] := array['id', 'sold', 'rating', 'created_at', 'auto_hidden', 'source', 'source_product_id'];
begin
  foreach col in array allowed loop
    if not has_column_privilege('authenticated', 'public.products', col, 'INSERT')
       or not has_column_privilege('authenticated', 'public.products', col, 'UPDATE') then
      raise exception '自我檢查失敗：authenticated 缺少 products.% 的寫入權限', col;
    end if;
  end loop;
  foreach col in array denied loop
    if has_column_privilege('authenticated', 'public.products', col, 'INSERT')
       or has_column_privilege('authenticated', 'public.products', col, 'UPDATE') then
      raise exception '自我檢查失敗：authenticated 仍可寫 products.%', col;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.products', 'INSERT') or has_table_privilege('anon', 'public.products', 'UPDATE')
     or has_table_privilege('anon', 'public.products', 'DELETE') or has_table_privilege('anon', 'public.products', 'TRUNCATE')
     or not has_table_privilege('anon', 'public.products', 'SELECT') then
    raise exception '自我檢查失敗：anon 的 products 權限不是「只讀」';
  end if;
  if not has_table_privilege('authenticated', 'public.products', 'SELECT')
     or not has_table_privilege('authenticated', 'public.products', 'DELETE')
     or has_table_privilege('authenticated', 'public.products', 'TRUNCATE') then
    raise exception '自我檢查失敗：authenticated 的表級權限不符';
  end if;

  foreach c in array array['products_images_shape_check', 'products_variants_shape_check', 'products_description_len_check',
                           'products_location_len_check', 'products_category_len_check'] loop
    if not exists (select 1 from pg_constraint where conname = c and conrelid = 'public.products'::regclass) then
      raise exception '自我檢查失敗：缺少約束 %', c;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conname = 'products_images_max_check' and conrelid = 'public.products'::regclass) then
    raise exception '自我檢查失敗：舊的 products_images_max_check 還在';
  end if;

  foreach f in array array['products_jsonb_int_between', 'products_jsonb_text_len', 'products_variants_valid', 'products_images_valid'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f and p.provolatile = 'i'
                      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')) then
      raise exception '自我檢查失敗：函式 % 不存在、不是 immutable，或沒有固定 search_path', f;
    end if;
  end loop;

  -- RLS 與 policy 不動
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_write_own') then
    raise exception '自我檢查失敗：products 的 RLS policy 不見了';
  end if;
end $$;

commit;
