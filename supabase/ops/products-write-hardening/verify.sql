-- products 寫入收斂：套用後（或套用前）的唯讀狀態報告（只有 SELECT；整支是單一指令，回一欄 JSON）
--
-- 用法（正式站唯讀）：
--   npx supabase db query --linked --read-only -f supabase/ops/products-write-hardening/verify.sql
-- 輸出（stdout 開頭有一行 `Initialising login role...`，解析時先切到第一個 `{`）：
--   table_privileges    anon／authenticated／service_role 的「表級」權限
--   column_privileges   每個欄位對 anon／authenticated 的 select／insert／update（表級或欄位級任一有就算有）
--   constraints         products 上的 CHECK：名稱、是否 validated、定義
--   functions           檢查函式：是否存在、volatility（i＝immutable）、是否固定 search_path
--   policies            products 的 RLS policy 名稱
--   summary             四個布林：grants_hardened／constraints_present／constraints_validated／functions_ok
--                       constraints_present 為 true 但 constraints_validated 為 false ＝ 約束已在管新寫入，
--                       既有列有不合的（用 precheck.sql 找出來，處理後重跑 migration）
-- 套用前與 rollback 之後輸出應一致（summary 全為 false 的那組）。

with
cols as (
  select a.attname::text as col, a.attnum
    from pg_attribute a
   where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped
),
cons as (
  select conname::text as name, convalidated as validated, pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid = 'public.products'::regclass and contype = 'c'
),
fns as (
  select f.name,
         (select jsonb_build_object('exists', true, 'volatility', p.provolatile::text,
                                    'search_path_fixed', exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = f.name limit 1) as info
    from unnest(array['products_jsonb_int_between', 'products_jsonb_text_len', 'products_variants_valid', 'products_images_valid']) as f(name)
),
authw as (
  select col, has_column_privilege('authenticated', 'public.products', col, 'INSERT')
              and has_column_privilege('authenticated', 'public.products', col, 'UPDATE') as writable
    from cols
)
select jsonb_build_object(
  'kind', 'products_write_hardening_verify',
  'rls_enabled', (select relrowsecurity from pg_class where oid = 'public.products'::regclass),
  'table_privileges', (
    select jsonb_object_agg(r, (select coalesce(jsonb_agg(pv order by pv), '[]'::jsonb)
                                  from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as pv
                                 where has_table_privilege(r, 'public.products', pv)))
      from unnest(array['anon', 'authenticated', 'service_role']) as r),
  'column_privileges', (
    select jsonb_object_agg(c.col, jsonb_build_object(
             'anon', (select coalesce(jsonb_agg(lower(pv) order by pv), '[]'::jsonb) from unnest(array['SELECT', 'INSERT', 'UPDATE']) as pv
                       where has_column_privilege('anon', 'public.products', c.col, pv)),
             'authenticated', (select coalesce(jsonb_agg(lower(pv) order by pv), '[]'::jsonb) from unnest(array['SELECT', 'INSERT', 'UPDATE']) as pv
                                where has_column_privilege('authenticated', 'public.products', c.col, pv))))
      from cols c),
  'constraints', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'validated', validated, 'definition', definition) order by name) from cons), '[]'::jsonb),
  'functions', (select jsonb_object_agg(name, coalesce(info, jsonb_build_object('exists', false))) from fns),
  'policies', coalesce((select jsonb_agg(policyname order by policyname) from pg_policies where schemaname = 'public' and tablename = 'products'), '[]'::jsonb),
  'summary', jsonb_build_object(
    'grants_hardened',
      not has_table_privilege('anon', 'public.products', 'INSERT') and not has_table_privilege('anon', 'public.products', 'UPDATE')
      and not has_table_privilege('anon', 'public.products', 'DELETE') and not has_table_privilege('authenticated', 'public.products', 'INSERT')
      and not has_table_privilege('authenticated', 'public.products', 'UPDATE')
      and (select bool_and(writable = (col = any (array['shop_id', 'title', 'description', 'category_id', 'images', 'variants', 'free_shipping', 'location', 'status']))) from authw),
    'constraints_present',
      (select count(*) from cons where name in ('products_images_shape_check', 'products_variants_shape_check', 'products_description_len_check',
                                                'products_location_len_check', 'products_category_len_check')) = 5,
    'constraints_validated',
      (select count(*) from cons where validated and name in ('products_images_shape_check', 'products_variants_shape_check', 'products_description_len_check',
                                                              'products_location_len_check', 'products_category_len_check')) = 5,
    'functions_ok',
      (select bool_and(coalesce(info->>'volatility' = 'i' and (info->>'search_path_fixed')::boolean, false)) from fns)
  )
) as verify;
