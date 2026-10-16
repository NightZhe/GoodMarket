-- 蝦皮商品一鍵匯入（規格 .work/shopee-import/spec.md v0.2，工單 T2）
-- 內容：D-1～D-7、D-9（商品來源欄位、匯入紀錄、圖片對照、四個匯入函式）與 D-10（Storage 上傳權限）
-- 全部可重複執行。只改結構與權限，不寫入任何資料。

-- ──────────────────────────── D-1、D-2、D-6：商品的來源欄位 ────────────────────────────

alter table public.products add column if not exists source text;
alter table public.products add column if not exists source_product_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_source_check') then
    alter table public.products add constraint products_source_check
      check (source is null or source in ('shopee'));
  end if;
  -- 來源與來源商品 ID 要嘛都有、要嘛都沒有（手動建立的商品兩者皆空）
  if not exists (select 1 from pg_constraint where conname = 'products_source_pair_check') then
    alter table public.products add constraint products_source_pair_check
      check ((source is null) = (source_product_id is null));
  end if;
  -- D-6：商品圖最多 9 張。NOT VALID＝只管新寫入與修改的列，不掃既有資料
  -- （既有資料依 UI 上限應 ≤ 6；套用正式站時用 verify SQL 確認後再 VALIDATE）
  if not exists (select 1 from pg_constraint where conname = 'products_images_max_check') then
    alter table public.products add constraint products_images_max_check
      check (jsonb_typeof(images) <> 'array' or jsonb_array_length(images) <= 9) not valid;
  end if;
end $$;

-- D-2：同一店內，同來源＋同來源商品 ID 至多一件。手動商品兩欄皆 null，null 不互相衝突
create unique index if not exists products_source_unique
  on public.products (shop_id, source, source_product_id);

-- ──────────────────────────── D-7：匯入紀錄 ────────────────────────────

create table if not exists public.product_imports (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops(id) on delete cascade,
  source           text not null check (source in ('shopee')),
  external_shop_id text not null,
  files            jsonb not null,                       -- [{ kind, fileName }]
  options          jsonb not null,                       -- { skipSoldOut, allHidden }
  total_products   integer not null check (total_products between 1 and 500),
  skipped          integer not null default 0 check (skipped >= 0),   -- 因「略過已售完」而不送的件數
  created_count    integer not null default 0,
  updated_count    integer not null default 0,
  failed_count     integer not null default 0,           -- 資料庫端失敗件＋前端回報的失敗件（不重複計）
  client_failures  jsonb not null default '[]'::jsonb,   -- finish 時前端送來的 [{ sourceProductId, code, message }]
  skipped_images   jsonb not null default '[]'::jsonb,   -- finish 時送來的 [{ sourceProductId, slot, sourceUrl, code }]
  failures         jsonb not null default '[]'::jsonb,   -- finish 時彙整的失敗清單：資料庫端＋前端
  status           text not null default 'running' check (status in ('running', 'completed')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists product_imports_shop_idx on public.product_imports (shop_id, started_at desc);

-- 每次匯入中，每件來源商品的寫入結果（支援重送冪等、累計件數與「不同商品 ID 上限」判斷）
create table if not exists public.product_import_items (
  import_id         uuid not null references public.product_imports(id) on delete cascade,
  source_product_id text not null,
  outcome           text not null check (outcome in ('created', 'updated', 'failed')),
  product_id        uuid references public.products(id) on delete set null,
  error_code        text,
  error_message     text,
  updated_at        timestamptz not null default now(),
  primary key (import_id, source_product_id)
);

-- D-4：本店已轉存圖片的「蝦皮來源網址 → 好物集網址」對照（重匯不重傳）
create table if not exists public.product_import_images (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  source     text not null check (source in ('shopee')),
  source_url text not null,
  url        text not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, source, source_url)
);

-- RLS：只有店主讀得到；沒有任何 insert／update／delete 政策，寫入只經由下面的函式
alter table public.product_imports       enable row level security;
alter table public.product_import_items  enable row level security;
alter table public.product_import_images enable row level security;

drop policy if exists product_imports_read_own on public.product_imports;
create policy product_imports_read_own on public.product_imports for select to authenticated
  using (exists (select 1 from public.shops s where s.id = product_imports.shop_id and s.owner_id = auth.uid()));

drop policy if exists product_import_items_read_own on public.product_import_items;
create policy product_import_items_read_own on public.product_import_items for select to authenticated
  using (exists (select 1 from public.product_imports i
                 join public.shops s on s.id = i.shop_id
                 where i.id = product_import_items.import_id and s.owner_id = auth.uid()));

drop policy if exists product_import_images_read_own on public.product_import_images;
create policy product_import_images_read_own on public.product_import_images for select to authenticated
  using (exists (select 1 from public.shops s where s.id = product_import_images.shop_id and s.owner_id = auth.uid()));

-- 預設權限會把新表全開給 anon／authenticated，這裡收回，只留 authenticated 的讀取（再由 RLS 限店主）
revoke all on public.product_imports, public.product_import_items, public.product_import_images from anon, authenticated;
grant select on public.product_imports, public.product_import_items, public.product_import_images to authenticated;

-- ──────────────────────────── 內部工具函式（不開放給前端） ────────────────────────────

-- 呼叫層錯誤：message＝中文說明、hint＝機器代碼（supabase-js 的 error.message／error.hint）
create or replace function public._imp_raise(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception '%', p_message using hint = p_code;
end $$;

-- 登入者的店 id；未登入 → NOT_AUTHENTICATED，沒有店 → NO_SHOP
create or replace function public._imp_shop()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_shop uuid;
begin
  if v_uid is null then
    perform public._imp_raise('NOT_AUTHENTICATED', '請先登入');
  end if;
  select s.id into v_shop from public.shops s where s.owner_id = v_uid;
  if v_shop is null then
    perform public._imp_raise('NO_SHOP', '你還沒有開店');
  end if;
  return v_shop;
end $$;

-- 是 JSON 數字且為整數、落在 [lo, hi]
create or replace function public._imp_int_between(p_val jsonb, p_lo numeric, p_hi numeric)
returns boolean language sql immutable as $$
  select p_val is not null and jsonb_typeof(p_val) = 'number'
         and (p_val #>> '{}')::numeric = trunc((p_val #>> '{}')::numeric)
         and (p_val #>> '{}')::numeric between p_lo and p_hi;
$$;

-- 圖片網址是否為「本店」的 Storage 公開網址：
--   {任意 host}/storage/v1/object/public/product-images/{店 id}/{檔名…}
-- 不寫死任何網域，本機（127.0.0.1:54321）與正式站（*.supabase.co）都適用。
create or replace function public._imp_url_ok(p_url jsonb, p_shop uuid)
returns boolean language sql immutable as $$
  select p_url is not null and jsonb_typeof(p_url) = 'string'
         and (p_url #>> '{}') ~ ('^https?://[^/?#[:space:]]+/storage/v1/object/public/product-images/'
                                 || p_shop::text || '/[^?#[:space:]]+$')
         and (p_url #>> '{}') !~* '(\.\.|%2e)';
$$;

-- 依 items 表與紀錄表重算匯入紀錄的件數
create or replace function public._imp_refresh(p_import_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.product_imports i set
    created_count = (select count(*) from public.product_import_items t where t.import_id = i.id and t.outcome = 'created'),
    updated_count = (select count(*) from public.product_import_items t where t.import_id = i.id and t.outcome = 'updated'),
    failed_count  = (select count(*) from (
                       select t.source_product_id from public.product_import_items t
                        where t.import_id = i.id and t.outcome = 'failed'
                       union
                       select f->>'sourceProductId' from jsonb_array_elements(i.client_failures) f
                     ) u)
  where i.id = p_import_id;
end $$;

-- ImportRecord（規格 6.0）
create or replace function public._imp_record(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'importId', i.id, 'status', i.status,
    'startedAt', i.started_at, 'finishedAt', i.finished_at,
    'totalProducts', i.total_products,
    'created', i.created_count, 'updated', i.updated_count, 'failed', i.failed_count,
    'skipped', i.skipped,
    'skippedImages', jsonb_array_length(i.skipped_images))
  from public.product_imports i where i.id = p_import_id;
$$;

-- 寫入單一 item（驗證＋新增或更新）。回傳 results[] 的一個元素。
-- 驗證失敗只回 failed、不寫入；寫入中的資料庫錯誤由呼叫端的 exception 區塊轉成 INTERNAL。
create or replace function public._imp_process_item(p_shop uuid, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_sid     text;
  v_cats    constant text[] := array['women','men','beauty','3c','home','food','sports','baby','games','toys','other'];
  v_images  jsonb := p_item->'images';
  v_vars    jsonb := p_item->'variants';
  v_desc    text;
  v_e       jsonb;
  v_seen_n  text[] := array[]::text[];
  v_seen_s  text[] := array[]::text[];
  v_prod    public.products%rowtype;
  v_pid     uuid;
  v_status  text;
  v_new_variants jsonb;
  v_img_urls jsonb;
  v_location text;
begin
  -- ── 驗證 ──
  if jsonb_typeof(p_item->'sourceProductId') = 'string' then
    v_sid := p_item->>'sourceProductId';
  end if;
  if v_sid is null or v_sid !~ '^[0-9]{1,20}$' then
    v_errors := v_errors || jsonb_build_object('code', 'SOURCE_ID_INVALID', 'field', 'sourceProductId',
                                               'message', '來源商品 ID 必須是 1–20 位數字的字串');
  end if;

  if jsonb_typeof(p_item->'title') is distinct from 'string'
     or char_length(p_item->>'title') not between 5 and 60 then
    v_errors := v_errors || jsonb_build_object('code', 'TITLE_LENGTH', 'field', 'title',
                                               'message', '商品名稱需為 5–60 字');
  end if;

  if p_item->'description' is null or jsonb_typeof(p_item->'description') = 'null' then
    v_desc := '';
  elsif jsonb_typeof(p_item->'description') = 'string' then
    v_desc := p_item->>'description';
  else
    v_errors := v_errors || jsonb_build_object('code', 'INTERNAL', 'field', 'description',
                                               'message', '商品描述必須是字串');
  end if;

  if jsonb_typeof(p_item->'categoryId') is distinct from 'string'
     or not ((p_item->>'categoryId') = any (v_cats)) then
    v_errors := v_errors || jsonb_build_object('code', 'CATEGORY_INVALID', 'field', 'categoryId',
                                               'message', '分類不在 11 類之內');
  end if;

  if jsonb_typeof(p_item->'status') is distinct from 'string'
     or (p_item->>'status') not in ('active', 'hidden') then
    v_errors := v_errors || jsonb_build_object('code', 'STATUS_INVALID', 'field', 'status',
                                               'message', '狀態必須是 active 或 hidden');
  end if;

  if jsonb_typeof(v_images) is distinct from 'array'
     or jsonb_array_length(v_images) not between 1 and 9 then
    v_errors := v_errors || jsonb_build_object('code', 'IMAGE_COUNT', 'field', 'images',
                                               'message', '商品圖需為 1–9 張');
  end if;
  if jsonb_typeof(v_images) = 'array' then
    for v_i in 0 .. jsonb_array_length(v_images) - 1 loop
      v_e := v_images -> v_i;
      if jsonb_typeof(v_e) is distinct from 'object' or not public._imp_url_ok(v_e->'url', p_shop) then
        v_errors := v_errors || jsonb_build_object('code', 'IMAGE_NOT_TRANSFERRED',
                      'field', format('images[%s].url', v_i), 'message', '圖片尚未轉存到本店的儲存空間');
      elsif jsonb_typeof(v_e->'sourceUrl') is distinct from 'string' or btrim(v_e->>'sourceUrl') = '' then
        v_errors := v_errors || jsonb_build_object('code', 'IMAGE_NOT_TRANSFERRED',
                      'field', format('images[%s].sourceUrl', v_i), 'message', '缺少圖片的蝦皮來源網址');
      end if;
    end loop;
  end if;

  if jsonb_typeof(v_vars) is distinct from 'array' or jsonb_array_length(v_vars) = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'VARIANT_REQUIRED', 'field', 'variants',
                                               'message', '至少需要一個規格');
  else
    for v_i in 0 .. jsonb_array_length(v_vars) - 1 loop
      v_e := v_vars -> v_i;
      if jsonb_typeof(v_e) is distinct from 'object' then
        v_errors := v_errors || jsonb_build_object('code', 'VARIANT_REQUIRED', 'field', format('variants[%s]', v_i),
                                                   'message', '規格格式不正確');
        continue;
      end if;

      if jsonb_typeof(v_e->'sourceVariantId') is distinct from 'string'
         or (v_e->>'sourceVariantId') !~ '^[0-9]{1,20}$' then
        v_errors := v_errors || jsonb_build_object('code', 'SOURCE_ID_INVALID',
                      'field', format('variants[%s].sourceVariantId', v_i),
                      'message', '規格來源 ID 必須是 1–20 位數字的字串');
      elsif (v_e->>'sourceVariantId') = any (v_seen_s) then
        v_errors := v_errors || jsonb_build_object('code', 'VARIANT_SOURCE_DUPLICATE',
                      'field', format('variants[%s].sourceVariantId', v_i), 'message', '規格來源 ID 重複');
      else
        v_seen_s := v_seen_s || (v_e->>'sourceVariantId');
      end if;

      if jsonb_typeof(v_e->'name') is distinct from 'string' or btrim(v_e->>'name') = '' then
        v_errors := v_errors || jsonb_build_object('code', 'VARIANT_NAME_INVALID',
                      'field', format('variants[%s].name', v_i), 'message', '規格名稱不可空白');
      elsif (v_e->>'name') = any (v_seen_n) then
        v_errors := v_errors || jsonb_build_object('code', 'VARIANT_NAME_DUPLICATE',
                      'field', format('variants[%s].name', v_i), 'message', '規格名稱重複');
      else
        v_seen_n := v_seen_n || (v_e->>'name');
      end if;

      if not public._imp_int_between(v_e->'price', 1, 499999) then
        v_errors := v_errors || jsonb_build_object('code', 'PRICE_INVALID',
                      'field', format('variants[%s].price', v_i), 'message', '價格需為 1–499,999 的整數');
      end if;
      -- 上限 2147483647：place_order 以 integer 讀庫存，超過會在下單時出錯
      if not public._imp_int_between(v_e->'stock', 0, 2147483647) then
        v_errors := v_errors || jsonb_build_object('code', 'STOCK_INVALID',
                      'field', format('variants[%s].stock', v_i), 'message', '庫存需為 0 以上的整數');
      end if;

      if v_e ? 'image' and jsonb_typeof(v_e->'image') <> 'null' then
        if jsonb_typeof(v_e->'image') is distinct from 'object' or not public._imp_url_ok(v_e#>'{image,url}', p_shop) then
          v_errors := v_errors || jsonb_build_object('code', 'IMAGE_NOT_TRANSFERRED',
                        'field', format('variants[%s].image.url', v_i), 'message', '規格圖尚未轉存到本店的儲存空間');
        elsif jsonb_typeof(v_e#>'{image,sourceUrl}') is distinct from 'string' or btrim(v_e#>>'{image,sourceUrl}') = '' then
          v_errors := v_errors || jsonb_build_object('code', 'IMAGE_NOT_TRANSFERRED',
                        'field', format('variants[%s].image.sourceUrl', v_i), 'message', '缺少規格圖的蝦皮來源網址');
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('sourceProductId', coalesce(v_sid, ''), 'outcome', 'failed',
                              'productId', null, 'status', null, 'errors', v_errors);
  end if;

  -- ── 整理要寫入的資料 ──
  select coalesce(jsonb_agg(to_jsonb(e->>'url') order by ord), '[]'::jsonb) into v_img_urls
    from jsonb_array_elements(v_images) with ordinality as t(e, ord);

  -- 圖片對照：同一個來源網址在同一個陳述式內只能出現一次；依來源網址排序以固定鎖定順序
  insert into public.product_import_images (shop_id, source, source_url, url)
  select p_shop, 'shopee', x.source_url, x.url
    from (
      select distinct on (s) s as source_url, u as url from (
        select e->>'sourceUrl' as s, e->>'url' as u
          from jsonb_array_elements(v_images) e
        union all
        select e#>>'{image,sourceUrl}', e#>>'{image,url}'
          from jsonb_array_elements(v_vars) e
         where jsonb_typeof(e->'image') = 'object'
      ) q where s is not null
      order by s
    ) x
  order by x.source_url
  on conflict (shop_id, source, source_url) do update set url = excluded.url;

  -- ── 新增或更新 ──
  select * into v_prod from public.products
   where shop_id = p_shop and source = 'shopee' and source_product_id = v_sid for update;

  if not found then
    -- 新規格：內部 id 由資料庫發
    select jsonb_agg(
             jsonb_strip_nulls(jsonb_build_object(
               'id', 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
               'name', e->>'name',
               'price', ((e->>'price')::numeric)::bigint,
               'stock', ((e->>'stock')::numeric)::bigint,
               'sourceId', e->>'sourceVariantId',
               'image', e#>>'{image,url}'))
             order by ord)
      into v_new_variants
      from jsonb_array_elements(v_vars) with ordinality as t(e, ord);

    select location into v_location from public.shops where id = p_shop;

    insert into public.products (shop_id, title, description, category_id, images, variants,
                                 status, location, source, source_product_id, created_at)
    values (p_shop, p_item->>'title', v_desc, p_item->>'categoryId', v_img_urls, v_new_variants,
            p_item->>'status', coalesce(v_location, '臺北市'), 'shopee', v_sid, clock_timestamp())
    on conflict (shop_id, source, source_product_id) do nothing
    returning id into v_pid;

    if v_pid is not null then
      return jsonb_build_object('sourceProductId', v_sid, 'outcome', 'created', 'productId', v_pid,
                                'status', p_item->>'status', 'errors', '[]'::jsonb);
    end if;

    -- 併發：另一個交易剛好先建立了同一件。等它提交後，改走更新
    select * into v_prod from public.products
     where shop_id = p_shop and source = 'shopee' and source_product_id = v_sid for update;
  end if;

  -- 更新（F-5.6）：只動 描述、商品圖、規格；名稱、分類、免運、銷量、評分、所在地不動
  -- 規格：以 sourceId 對應 → 保留內部 id 與其他未知鍵；檔案新增的 → 新增；檔案沒有的 → 移除；
  --       沒有 sourceId 的（賣家手動加的）→ 保留在最後
  select coalesce(jsonb_agg(v order by grp, ord), '[]'::jsonb) into v_new_variants from (
    select 0 as grp, n.ord,
           case when o.e is not null then
                  (o.e - 'image' - 'originalPrice')
                  || jsonb_build_object('name', n.e->>'name',
                                        'price', ((n.e->>'price')::numeric)::bigint,
                                        'stock', ((n.e->>'stock')::numeric)::bigint,
                                        'sourceId', n.e->>'sourceVariantId')
                  || case when jsonb_typeof(n.e->'image') = 'object'
                          then jsonb_build_object('image', n.e#>>'{image,url}') else '{}'::jsonb end
                  -- 原價仍高於新售價才保留（維持編輯頁「原價須高於售價」）
                  || case when o.e ? 'originalPrice' and jsonb_typeof(o.e->'originalPrice') = 'number'
                               and (o.e->>'originalPrice')::numeric > (n.e->>'price')::numeric
                          then jsonb_build_object('originalPrice', o.e->'originalPrice') else '{}'::jsonb end
                else
                  jsonb_strip_nulls(jsonb_build_object(
                    'id', 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
                    'name', n.e->>'name',
                    'price', ((n.e->>'price')::numeric)::bigint,
                    'stock', ((n.e->>'stock')::numeric)::bigint,
                    'sourceId', n.e->>'sourceVariantId',
                    'image', n.e#>>'{image,url}'))
           end as v
      from jsonb_array_elements(v_vars) with ordinality as n(e, ord)
      left join (
        select e, e->>'sourceId' as sid
          from jsonb_array_elements(case when jsonb_typeof(v_prod.variants) = 'array' then v_prod.variants else '[]'::jsonb end) e
         where e->>'sourceId' is not null
      ) o on o.sid = n.e->>'sourceVariantId'
    union all
    select 1, ord, e
      from jsonb_array_elements(case when jsonb_typeof(v_prod.variants) = 'array' then v_prod.variants else '[]'::jsonb end)
           with ordinality as m(e, ord)
     where e->>'sourceId' is null
  ) s;

  -- Q-2：同步後所有規格（含保留的手動規格）庫存皆 0 → 下架；否則維持原狀
  if exists (select 1 from jsonb_array_elements(v_new_variants) x
              where coalesce((x->>'stock')::numeric, 0) > 0) then
    v_status := v_prod.status;
  else
    v_status := 'hidden';
  end if;

  update public.products set description = v_desc, images = v_img_urls,
                             variants = v_new_variants, status = v_status
   where id = v_prod.id;

  return jsonb_build_object('sourceProductId', v_sid, 'outcome', 'updated', 'productId', v_prod.id,
                            'status', v_status, 'errors', '[]'::jsonb);
end $$;

-- ──────────────────────────── ① start_product_import ────────────────────────────

create or replace function public.start_product_import(p_source text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop  uuid := public._imp_shop();
  v_files jsonb;
  v_kinds text[];
  v_row   public.product_imports%rowtype;
begin
  if p_source is distinct from 'shopee' then
    perform public._imp_raise('INVALID_PAYLOAD', '來源必須是 shopee');
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    perform public._imp_raise('INVALID_PAYLOAD', '缺少匯入資訊');
  end if;
  if jsonb_typeof(p_meta->'externalShopId') is distinct from 'string' or btrim(p_meta->>'externalShopId') = ''
     or char_length(p_meta->>'externalShopId') > 40 then
    perform public._imp_raise('INVALID_PAYLOAD', '蝦皮店家 ID 不正確');
  end if;

  v_files := p_meta->'files';
  if jsonb_typeof(v_files) is distinct from 'array' or jsonb_array_length(v_files) <> 3
     or exists (select 1 from jsonb_array_elements(v_files) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'kind') is distinct from 'string'
                    or jsonb_typeof(f->'fileName') is distinct from 'string'
                    or btrim(f->>'fileName') = '') then
    perform public._imp_raise('INVALID_PAYLOAD', '必須恰好有三個檔案（basic_info、sales_info、media_info 各一）');
  end if;
  select array_agg(f->>'kind' order by f->>'kind') into v_kinds from jsonb_array_elements(v_files) f;
  if v_kinds is distinct from array['basic_info', 'media_info', 'sales_info'] then
    perform public._imp_raise('INVALID_PAYLOAD', '必須恰好有三個檔案（basic_info、sales_info、media_info 各一）');
  end if;

  if not public._imp_int_between(p_meta->'totalProducts', 1, 1000000) then
    perform public._imp_raise('INVALID_PAYLOAD', '商品件數必須是 1 以上的整數');
  end if;
  if (p_meta->>'totalProducts')::numeric > 500 then
    perform public._imp_raise('IMPORT_LIMIT_EXCEEDED', '一次最多匯入 500 件商品');
  end if;
  if not public._imp_int_between(p_meta->'skipped', 0, 1000000) then
    perform public._imp_raise('INVALID_PAYLOAD', '略過件數必須是 0 以上的整數');
  end if;
  if jsonb_typeof(p_meta->'options') is distinct from 'object'
     or jsonb_typeof(p_meta#>'{options,skipSoldOut}') is distinct from 'boolean'
     or jsonb_typeof(p_meta#>'{options,allHidden}') is distinct from 'boolean' then
    perform public._imp_raise('INVALID_PAYLOAD', '匯入選項不正確');
  end if;

  insert into public.product_imports (shop_id, source, external_shop_id, files, options, total_products, skipped)
  values (v_shop, 'shopee', btrim(p_meta->>'externalShopId'),
          (select jsonb_agg(jsonb_build_object('kind', f->>'kind', 'fileName', f->>'fileName'))
             from jsonb_array_elements(v_files) f),
          jsonb_build_object('skipSoldOut', (p_meta#>>'{options,skipSoldOut}')::boolean,
                             'allHidden', (p_meta#>>'{options,allHidden}')::boolean),
          (p_meta->>'totalProducts')::numeric::integer, (p_meta->>'skipped')::numeric::integer)
  returning * into v_row;

  return jsonb_build_object('importId', v_row.id, 'startedAt', v_row.started_at);
end $$;

-- ──────────────────────────── ② import_products_batch ────────────────────────────

create or replace function public.import_products_batch(p_import_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop    uuid := public._imp_shop();
  v_id      uuid;
  v_imp     public.product_imports%rowtype;
  v_n       integer;
  v_distinct integer;
  v_dup     boolean[];
  v_seen    text[] := array[]::text[];
  v_sid     text;
  v_item    jsonb;
  v_idx     integer;
  v_res     jsonb;
  v_results jsonb[];
  v_err     jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    perform public._imp_raise('INVALID_PAYLOAD', 'items 必須是物件陣列');
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 or v_n > 100 then
    perform public._imp_raise('BATCH_TOO_LARGE', '每次呼叫必須有 1–100 件商品');
  end if;

  begin
    v_id := p_import_id::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  -- 鎖住這筆匯入紀錄：同一個匯入的批次依序進行
  select * into v_imp from public.product_imports where id = v_id and shop_id = v_shop for update;
  if not found then
    perform public._imp_raise('IMPORT_NOT_FOUND', '找不到這筆匯入');
  end if;
  if v_imp.status <> 'running' then
    perform public._imp_raise('IMPORT_CLOSED', '這筆匯入已結束，不能再寫入');
  end if;

  -- 此匯入累計的不同來源商品 ID 不可超過 totalProducts
  select count(*) into v_distinct from (
    select source_product_id from public.product_import_items where import_id = v_imp.id
    union
    select e->>'sourceProductId' from jsonb_array_elements(p_items) e
     where jsonb_typeof(e->'sourceProductId') = 'string'
  ) u;
  if v_distinct > v_imp.total_products then
    perform public._imp_raise('IMPORT_LIMIT_EXCEEDED',
      format('這次匯入累計的商品超過預計的 %s 件', v_imp.total_products));
  end if;

  -- 同一次呼叫內的重複：依輸入順序，第二個起算重複
  v_dup := array_fill(false, array[v_n]);
  v_results := array_fill(null::jsonb, array[v_n]);
  for v_pos in 1 .. v_n loop
    v_item := p_items -> (v_pos - 1);
    if jsonb_typeof(v_item->'sourceProductId') = 'string' then
      v_sid := v_item->>'sourceProductId';
      if v_sid = any (v_seen) then
        v_dup[v_pos] := true;
      else
        v_seen := v_seen || v_sid;
      end if;
    end if;
  end loop;

  -- 依來源商品 ID 排序處理：不同的匯入同時寫同一批商品時，取鎖順序一致，避免死結。
  -- 結果仍依輸入順序放回 results[]。
  for v_idx in
    select o.i from (
      select i, coalesce(p_items->(i - 1)->>'sourceProductId', '') as k, i as pos
        from generate_series(1, v_n) i
    ) o order by o.k, o.pos
  loop
    v_item := p_items -> (v_idx - 1);
    v_sid := case when jsonb_typeof(v_item->'sourceProductId') = 'string' then v_item->>'sourceProductId' else '' end;

    if v_dup[v_idx] then
      v_results[v_idx] := jsonb_build_object('sourceProductId', v_sid, 'outcome', 'failed',
        'productId', null, 'status', null,
        'errors', jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_IN_BATCH',
          'field', 'sourceProductId', 'message', '同一次呼叫內商品 ID 重複')));
      continue;
    end if;

    begin
      v_res := public._imp_process_item(v_shop, v_item);
    exception when others then
      -- 單件原子：這件的寫入整件回復，其他件不受影響
      v_res := jsonb_build_object('sourceProductId', v_sid, 'outcome', 'failed', 'productId', null, 'status', null,
        'errors', jsonb_build_array(jsonb_build_object('code', 'INTERNAL', 'field', '', 'message', SQLERRM)));
    end;
    v_results[v_idx] := v_res;

    if v_sid ~ '^[0-9]{1,20}$' then
      v_err := v_res->'errors'->0;
      -- created 不會被後續的 updated 蓋掉；已成功的不會被失敗蓋掉；失敗後重送成功則改為成功
      insert into public.product_import_items as t (import_id, source_product_id, outcome, product_id, error_code, error_message)
      values (v_imp.id, v_sid, v_res->>'outcome', (v_res->>'productId')::uuid,
              v_err->>'code', v_err->>'message')
      on conflict (import_id, source_product_id) do update set
        outcome = case
                    when t.outcome = 'created' and excluded.outcome <> 'failed' then 'created'
                    when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.outcome
                    else excluded.outcome end,
        product_id = coalesce(excluded.product_id, t.product_id),
        error_code = case when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.error_code
                          else excluded.error_code end,
        error_message = case when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.error_message
                             else excluded.error_message end,
        updated_at = now();
    end if;
  end loop;

  perform public._imp_refresh(v_imp.id);

  return jsonb_build_object('importId', v_imp.id, 'results', to_jsonb(v_results));
end $$;

-- ──────────────────────────── ③ finish_product_import ────────────────────────────

create or replace function public.finish_product_import(p_import_id text, p_client_failures jsonb, p_skipped_images jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._imp_shop();
  v_id   uuid;
  v_imp  public.product_imports%rowtype;
begin
  if p_client_failures is null or jsonb_typeof(p_client_failures) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_client_failures) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'sourceProductId') is distinct from 'string'
                    or jsonb_typeof(f->'code') is distinct from 'string'
                    or jsonb_typeof(f->'message') is distinct from 'string') then
    perform public._imp_raise('INVALID_PAYLOAD', 'client failures 格式不正確');
  end if;
  if p_skipped_images is null or jsonb_typeof(p_skipped_images) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_skipped_images) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'sourceProductId') is distinct from 'string'
                    or jsonb_typeof(f->'slot') is distinct from 'string'
                    or jsonb_typeof(f->'sourceUrl') is distinct from 'string'
                    or coalesce(f->>'code', '') not in ('IMAGE_DOWNLOAD_FAILED', 'IMAGE_UPLOAD_FAILED')) then
    perform public._imp_raise('INVALID_PAYLOAD', 'skipped images 格式不正確');
  end if;

  begin
    v_id := p_import_id::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  select * into v_imp from public.product_imports where id = v_id and shop_id = v_shop for update;
  if not found then
    perform public._imp_raise('IMPORT_NOT_FOUND', '找不到這筆匯入');
  end if;
  if v_imp.status <> 'running' then
    perform public._imp_raise('IMPORT_CLOSED', '這筆匯入已結束');
  end if;

  update public.product_imports
     set client_failures = p_client_failures, skipped_images = p_skipped_images
   where id = v_imp.id;
  perform public._imp_refresh(v_imp.id);

  -- 失敗清單：資料庫端失敗的件（商品 ID＋原因代碼）＋前端回報的件；同一件商品只列一次
  update public.product_imports i set
    status = 'completed', finished_at = now(),
    failures = coalesce((
      select jsonb_agg(x order by x->>'sourceProductId') from (
        select distinct on (sid) sid, x from (
          select t.source_product_id as sid,
                 jsonb_build_object('sourceProductId', t.source_product_id, 'code', t.error_code,
                                    'message', t.error_message, 'origin', 'server') as x, 0 as pri
            from public.product_import_items t where t.import_id = i.id and t.outcome = 'failed'
          union all
          select f->>'sourceProductId',
                 jsonb_build_object('sourceProductId', f->>'sourceProductId', 'code', f->>'code',
                                    'message', f->>'message', 'origin', 'client'), 1
            from jsonb_array_elements(i.client_failures) f
        ) q order by sid, pri
      ) d(sid, x)), '[]'::jsonb)
  where i.id = v_imp.id;

  return public._imp_record(v_imp.id);
end $$;

-- ──────────────────────────── ④ get_import_index ────────────────────────────

create or replace function public.get_import_index(p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._imp_shop();
  v_last uuid;
begin
  if p_source is distinct from 'shopee' then
    perform public._imp_raise('INVALID_PAYLOAD', '來源必須是 shopee');
  end if;

  select id into v_last from public.product_imports
   where shop_id = v_shop and source = p_source order by started_at desc limit 1;

  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sourceProductId', p.source_product_id, 'productId', p.id, 'status', p.status,
               'variants', coalesce((
                  select jsonb_agg(jsonb_build_object('sourceVariantId', v->>'sourceId', 'variantId', v->>'id'))
                    from jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) v
                   where v->>'sourceId' is not null), '[]'::jsonb))
             order by p.source_product_id)
        from public.products p where p.shop_id = v_shop and p.source = p_source), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('sourceUrl', m.source_url, 'url', m.url) order by m.source_url)
        from public.product_import_images m where m.shop_id = v_shop and m.source = p_source), '[]'::jsonb),
    'lastImport', case when v_last is null then null else public._imp_record(v_last) end);
end $$;

-- ──────────────────────────── 函式權限 ────────────────────────────
-- 預設權限會把新函式開給 anon／authenticated：內部工具函式全部收回；
-- 四個對外函式開給 anon（未登入呼叫時要回 NOT_AUTHENTICATED）與 authenticated。

revoke all on function public._imp_raise(text, text)               from public, anon, authenticated;
revoke all on function public._imp_shop()                          from public, anon, authenticated;
revoke all on function public._imp_int_between(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public._imp_url_ok(jsonb, uuid)             from public, anon, authenticated;
revoke all on function public._imp_refresh(uuid)                   from public, anon, authenticated;
revoke all on function public._imp_record(uuid)                    from public, anon, authenticated;
revoke all on function public._imp_process_item(uuid, jsonb)       from public, anon, authenticated;

revoke all on function public.start_product_import(text, jsonb)            from public;
revoke all on function public.import_products_batch(text, jsonb)           from public;
revoke all on function public.finish_product_import(text, jsonb, jsonb)    from public;
revoke all on function public.get_import_index(text)                       from public;
grant execute on function public.start_product_import(text, jsonb)         to anon, authenticated;
grant execute on function public.import_products_batch(text, jsonb)        to anon, authenticated;
grant execute on function public.finish_product_import(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_import_index(text)                    to anon, authenticated;

-- ──────────────────────────── D-10：Storage 上傳權限（Q-8） ────────────────────────────
-- 登入者只能在 product-images 中「自己商店 id 的資料夾」新增物件。
-- 根目錄、別人的資料夾、沒有開店的帳號、未登入，一律不行。讀取與刪除規則不變。

drop policy if exists product_images_write on storage.objects;
create policy product_images_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (select s.id::text from public.shops s where s.owner_id = auth.uid())
  );
