-- VALIDATE 失敗情境（步驟 2／3）：套完 migration 後的斷言。需要 psql 變數 precheck（套用前跑 precheck.sql 的 JSON）與 verify（套用後跑 verify.sql 的 JSON）。
-- 預期：權限已收斂、五條約束都存在但 convalidated=false（有不合的列）、新寫入仍受檢查、precheck 列得出壞列、verify 看得出來。

\set ON_ERROR_STOP on
\pset pager off
begin;
create schema pwh_t;
grant usage on schema pwh_t to authenticated, anon, service_role;
create table pwh_t.results (n serial primary key, grp text, label text, expected text, got text, detail text, ok boolean);

create function pwh_t.try(p_label text, p_expected text, p_role text, p_uid uuid, p_stmt text, p_like text default null)
returns void language plpgsql as $$
declare v_got text := 'ok'; v_msg text := ''; v_rows bigint; v_ok boolean;
begin
  begin
    perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
    execute format('set local role %I', p_role);
    execute p_stmt;
    get diagnostics v_rows = row_count;
    reset role;
  exception when others then
    v_got := sqlstate; v_msg := sqlerrm;
  end;
  reset role;
  if v_got = 'ok' and p_expected like 'rows:%' then v_got := 'rows:' || v_rows; end if;
  v_ok := v_got = p_expected and (p_like is null or position(p_like in v_msg) > 0);
  insert into pwh_t.results (grp, label, expected, got, detail, ok) values ('V', p_label, p_expected, v_got, left(v_msg, 160), v_ok);
end $$;
create function pwh_t.check(p_label text, p_cond boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into pwh_t.results (grp, label, expected, got, detail, ok) values ('V', p_label, 'true', coalesce(p_cond::text, 'null'), left(p_detail, 160), coalesce(p_cond, false));
end $$;

-- 權限與約束（verify 的 JSON）
select pwh_t.check('verify：grants_hardened = true（VALIDATE 失敗不影響權限收斂）', (:'verify'::jsonb #>> '{summary,grants_hardened}')::boolean);
select pwh_t.check('verify：constraints_present = true', (:'verify'::jsonb #>> '{summary,constraints_present}')::boolean);
select pwh_t.check('verify：constraints_validated = false（看得出還沒 validated）', not (:'verify'::jsonb #>> '{summary,constraints_validated}')::boolean);
select pwh_t.check('verify：functions_ok = true', (:'verify'::jsonb #>> '{summary,functions_ok}')::boolean);
select pwh_t.check('pg_constraint：五條都存在且 convalidated=false（每條都至少有一筆壞列）',
  (select count(*) from pg_constraint where conrelid = 'public.products'::regclass and not convalidated
     and conname in ('products_images_shape_check','products_variants_shape_check','products_description_len_check',
                     'products_location_len_check','products_category_len_check')) = 5);
select pwh_t.check('實際權限：anon 不可寫、authenticated 不可寫 sold',
  not has_table_privilege('anon', 'public.products', 'UPDATE') and not has_column_privilege('authenticated', 'public.products', 'sold', 'UPDATE'));

-- precheck（套用前跑的）：違規商品 ＝ 18 筆壞列；id 集合與「檢查函式＋長度條件」算出的一致
select pwh_t.check('precheck：violating_products = 18', (:'precheck'::jsonb->>'violating_products')::int = 18, :'precheck'::jsonb->>'violating_products');
select pwh_t.check('precheck：violations 的 id 集合 = 實際違規列（以檢查函式算）',
  (select coalesce(array_agg((v->>'id')::uuid order by (v->>'id')::uuid), '{}') from jsonb_array_elements(:'precheck'::jsonb->'violations') v)
  = (select coalesce(array_agg(id order by id), '{}') from public.products
      where not (public.products_variants_valid(variants) and public.products_images_valid(images)
                 and char_length(description) <= 10000 and char_length(location) <= 20 and char_length(category_id) <= 30)));
select pwh_t.check('precheck：基準列（合格）不在清單裡',
  not exists (select 1 from jsonb_array_elements(:'precheck'::jsonb->'violations') v where v->>'id' = 'dddddddd-2222-4222-8222-000000000000'));
select pwh_t.check('precheck：每個壞列都有原因（18 筆、每筆 reasons 非空）',
  (select count(*) from jsonb_array_elements(:'precheck'::jsonb->'violations') v where jsonb_array_length(v->'reasons') > 0) = 18);
select pwh_t.check('precheck：原因代碼涵蓋預期的 17 種',
  (select count(*) from jsonb_object_keys(:'precheck'::jsonb->'counts_by_reason')) >= 17, (:'precheck'::jsonb->'counts_by_reason')::text);

-- 新寫入仍受檢查（約束是 NOT VALID 狀態）
select pwh_t.try('賣家丁 insert 壞形狀 → 23514', '23514', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$insert into public.products (shop_id, title, description, category_id, images, variants, location, status)
    values ('dddddddd-1111-4111-8111-000000000001', '新寫入壞形狀測試', 'd', '3c', '[]', '[]', '高雄市', 'active')$$, 'products_variants_shape_check');
select pwh_t.try('賣家丁 insert 合格 → ok', 'ok', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$insert into public.products (shop_id, title, description, category_id, images, variants, location, status)
    values ('dddddddd-1111-4111-8111-000000000001', '新寫入合格測試商品', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active')$$);
select pwh_t.try('賣家丁 改合格基準列 → rows:1', 'rows:1', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$update public.products set title = '合格商品基準列改' where id = 'dddddddd-2222-4222-8222-000000000000'$$);
-- 還沒修的壞列：被修改時整列會重新檢查（NOT VALID 約束的行為）
select pwh_t.try('賣家丁 只改壞列的 title → 23514（要先把壞列修正）', '23514', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$update public.products set title = '壞列一號被改名了' where id = 'dddddddd-2222-4222-8222-000000000001'$$);
select pwh_t.try('賣家丁 把壞列修成合格 → rows:1', 'rows:1', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$update public.products set variants = '[{"id":"a","name":"n","price":1,"stock":1}]' where id = 'dddddddd-2222-4222-8222-000000000001'$$);
select pwh_t.try('賣家丁 刪除壞列 → rows:1（刪除不受影響）', 'rows:1', 'authenticated', 'dddddddd-0000-4000-8000-000000000001',
  $$delete from public.products where id = 'dddddddd-2222-4222-8222-000000000002'$$);
select pwh_t.try('買家端讀取壞列不受影響（anon select 全部 active）', 'ok', 'anon', null, $$select * from public.products where status = 'active'$$);

select grp, label, expected, got, ok, detail from pwh_t.results order by n;
do $$
declare f integer;
begin
  select count(*) into f from pwh_t.results where not ok;
  if f > 0 then raise exception '有 % 項測試失敗', f; end if;
  raise notice 'VALIDATE 失敗情境：全部 % 項通過', (select count(*) from pwh_t.results);
end $$;
rollback;
