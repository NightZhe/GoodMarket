-- products 寫入欄位收斂與資料形狀檢查：SQL 測試
--
-- 前提：已套用 20261111120000_products_write_hardening.sql 的本機資料庫（隔離實例，別對正式站跑）。
-- 用法：supabase/tests/run-products-write-hardening.sh（會連 migration 一起驗），或單跑：
--   docker exec -i <db 容器> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/products_write_hardening.sql
-- 整支包在一個交易裡，最後一律 rollback，不留資料。有任何一項不符就以非零狀態結束。
--
-- 角色：用 `set local role authenticated|anon|service_role` ＋ request.jwt.claims 模擬真的身分（不是 postgres）。
-- 預期結果寫法：'ok'＝成功；'rows:N'＝成功且影響 N 列；其餘是 SQLSTATE（42501＝權限／RLS、23514＝CHECK）。

\set ON_ERROR_STOP on
\pset pager off
begin;

create schema pwh_t;
grant usage on schema pwh_t to authenticated, anon, service_role;

create table pwh_t.results (
  n serial primary key, grp text, label text, expected text, got text, detail text, ok boolean
);

-- 以指定角色執行一條陳述式，記錄結果；p_like 不為 null 時，錯誤訊息還要包含這段文字
create function pwh_t.try(p_grp text, p_label text, p_expected text, p_role text, p_uid uuid, p_stmt text,
                          p_like text default null)
returns void language plpgsql as $$
declare v_got text := 'ok'; v_msg text := ''; v_rows bigint; v_ok boolean;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
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
  insert into pwh_t.results (grp, label, expected, got, detail, ok)
  values (p_grp, p_label, p_expected, v_got, left(v_msg, 160), v_ok);
end $$;

create function pwh_t.check(p_grp text, p_label text, p_cond boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into pwh_t.results (grp, label, expected, got, detail, ok)
  values (p_grp, p_label, 'true', coalesce(p_cond::text, 'null'), left(p_detail, 160), coalesce(p_cond, false));
end $$;

-- 檢查函式還不存在時（套用前的狀態）回 null 而不是讓整個交易中止，讓測試能跑完並列出所有失敗項
create function pwh_t.variants_valid(p jsonb) returns boolean language plpgsql as $$
begin
  return public.products_variants_valid(p);
exception when undefined_function then
  return null;
end $$;

-- ──────────────────────────── 固定資料（以 postgres 身分建立） ────────────────────────────
-- 賣家 A／B、買家 C；A 店有 PA1、PA2，B 店有 PB1

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pwh-a@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pwh-b@example.test'),
  ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pwh-c@example.test');
insert into public.shops (id, owner_id, name, location) values
  ('aaaaaaaa-1111-4111-8111-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', '測試店甲', '臺北市'),
  ('bbbbbbbb-1111-4111-8111-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', '測試店乙', '臺中市');
insert into public.products (id, shop_id, title, description, category_id, images, variants, location, status) values
  ('aaaaaaaa-2222-4222-8222-000000000001', 'aaaaaaaa-1111-4111-8111-000000000001', '甲店商品一號測試', 'd', '3c',
   '["art:x:#fff:#000"]', '[{"id":"v1","name":"黑色","price":100,"stock":10,"originalPrice":200},{"id":"v2","name":"白色","price":100,"stock":0}]', '臺北市', 'active'),
  ('aaaaaaaa-2222-4222-8222-000000000002', 'aaaaaaaa-1111-4111-8111-000000000001', '甲店商品二號測試', 'd', 'home',
   '["art:y:#fff:#000"]', '[{"id":"w1","name":"標準款","price":1000,"stock":5}]', '臺北市', 'active'),
  ('bbbbbbbb-2222-4222-8222-000000000001', 'bbbbbbbb-1111-4111-8111-000000000001', '乙店商品一號測試', 'd', '3c',
   '["art:z:#fff:#000"]', '[{"id":"x1","name":"預設","price":50,"stock":3}]', '臺中市', 'active');

\echo
\echo '=== 1. 欄位級授權：authenticated 賣家（甲） ==='

select pwh_t.try('1', 'insert 九欄', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into public.products (shop_id, title, description, category_id, images, variants, free_shipping, location, status)
    values ('aaaaaaaa-1111-4111-8111-000000000001', '賣家新增商品測試', 'd', '3c', '["https://example.test/a.jpg"]',
            '[{"id":"n1","name":"預設","price":10,"stock":1}]', true, '臺北市', 'active')$$);
select pwh_t.try('1', 'update 九欄', 'rows:1', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set shop_id = 'aaaaaaaa-1111-4111-8111-000000000001', title = '甲店商品一號改名', description = 'd2',
      category_id = 'home', images = '["art:x:#fff:#000"]', variants = '[{"id":"v1","name":"黑色","price":100,"stock":10}]',
      free_shipping = true, location = '臺北市', status = 'hidden'
    where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$);
select pwh_t.try('1', 'update 只改 status（上下架）', 'rows:1', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set status = 'active' where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$);

-- 九欄以外：insert 與 update 各一次
select pwh_t.try('1', 'insert 帶 ' || c.col || ' → 42501', '42501', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$insert into public.products (shop_id, title, description, category_id, images, variants, %I)
            values ('aaaaaaaa-1111-4111-8111-000000000001', '賣家新增商品測試', 'd', '3c', '[]',
                    '[{"id":"n1","name":"預設","price":10,"stock":1}]', %s)$f$, c.col, c.val),
  'permission denied for table products')
from (values ('id', '''aaaaaaaa-2222-4222-8222-0000000000f1''::uuid'), ('sold', '99'), ('rating', '1.0'),
             ('created_at', 'now()'), ('auto_hidden', 'true'), ('source', '''shopee'''),
             ('source_product_id', '''123''')) as c(col, val);
select pwh_t.try('1', 'update ' || c.col || ' → 42501', '42501', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$update public.products set %I = %s where id = 'aaaaaaaa-2222-4222-8222-000000000001'$f$, c.col, c.val),
  'permission denied for table products')
from (values ('id', '''aaaaaaaa-2222-4222-8222-0000000000f1''::uuid'), ('sold', '99'), ('rating', '1.0'),
             ('created_at', 'now()'), ('auto_hidden', 'true'), ('source', '''shopee'''),
             ('source_product_id', '''123''')) as c(col, val);
select pwh_t.try('1', 'update 九欄＋sold 混寫 → 42501', '42501', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set title = '甲店商品一號改名', sold = 5 where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$);
select pwh_t.try('1', 'select * 整表可讀（含 sold／rating）', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select * from public.products$$);
select pwh_t.try('1', 'insert 到別人的店 → RLS 擋（42501）', '42501', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into public.products (shop_id, title, description, category_id, images, variants, location, status)
    values ('bbbbbbbb-1111-4111-8111-000000000001', '賣家新增商品測試', 'd', '3c', '[]',
            '[{"id":"n1","name":"預設","price":10,"stock":1}]', '臺北市', 'active')$$,
  'row-level security');
select pwh_t.try('1', 'service_role 仍可寫 sold 與自訂 id', 'ok', 'service_role', null,
  $$insert into public.products (id, shop_id, title, description, category_id, images, variants, sold, rating, location, status, created_at)
    values ('aaaaaaaa-2222-4222-8222-0000000000f2', 'aaaaaaaa-1111-4111-8111-000000000001', '服務金鑰寫入測試', 'd', '3c', '[]',
            '[{"id":"s1","name":"預設","price":10,"stock":1}]', 7, 4.5, '臺北市', 'active', now());
    update public.products set sold = 8 where id = 'aaaaaaaa-2222-4222-8222-0000000000f2'$$);

\echo
\echo '=== 2. anon ==='
select pwh_t.try('2', 'anon select active', 'ok', 'anon', null, $$select count(*) from public.products where status = 'active'$$);
select pwh_t.try('2', 'anon insert → 42501', '42501', 'anon', null,
  $$insert into public.products (shop_id, title, description, category_id, images, variants, location, status)
    values ('aaaaaaaa-1111-4111-8111-000000000001', '匿名新增商品測試', 'd', '3c', '[]',
            '[{"id":"n1","name":"預設","price":10,"stock":1}]', '臺北市', 'active')$$, 'permission denied for table products');
select pwh_t.try('2', 'anon update → 42501', '42501', 'anon', null,
  $$update public.products set title = '匿名改名測試商品' where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$, 'permission denied for table products');
select pwh_t.try('2', 'anon delete → 42501', '42501', 'anon', null,
  $$delete from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$, 'permission denied for table products');

\echo
\echo '=== 5. 別人的商品（RLS 行為不變） ==='
select pwh_t.try('5', '乙 update 甲的商品 → 0 列', 'rows:0', 'authenticated', 'bbbbbbbb-0000-4000-8000-000000000001',
  $$update public.products set title = '乙想改甲的商品名稱' where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$);
select pwh_t.try('5', '乙 delete 甲的商品 → 0 列', 'rows:0', 'authenticated', 'bbbbbbbb-0000-4000-8000-000000000001',
  $$delete from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001'$$);
select pwh_t.try('5', '甲 delete 自己新增的商品 → 1 列', 'rows:1', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$delete from public.products where title = '賣家新增商品測試'$$);
select pwh_t.check('5', '甲的商品沒有被別人改到', (select title from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001') = '甲店商品一號改名');

\echo
\echo '=== 3. 形狀檢查：insert 與 update 各測一次，預期 23514（合格的邊界值預期 ok） ==='

create table pwh_t.cases (label text, col text, expr text, expected text);
insert into pwh_t.cases values
  -- variants：非法
  ('variants 是物件', 'variants', $$'{}'::jsonb$$, '23514'),
  ('variants 是字串', 'variants', $$'"x"'::jsonb$$, '23514'),
  ('variants 是 json null', 'variants', $$'null'::jsonb$$, '23514'),
  ('variants 是數字', 'variants', $$'5'::jsonb$$, '23514'),
  ('variants 空陣列', 'variants', $$'[]'::jsonb$$, '23514'),
  ('variants 元素是數字', 'variants', $$'[1]'::jsonb$$, '23514'),
  ('variants 元素是 null', 'variants', $$'[null]'::jsonb$$, '23514'),
  ('variants 元素是陣列', 'variants', $$'[[]]'::jsonb$$, '23514'),
  ('variants 元素是空物件', 'variants', $$'[{}]'::jsonb$$, '23514'),
  ('variants 缺 price', 'variants', $$'[{"id":"a","name":"n","stock":1}]'::jsonb$$, '23514'),
  ('variants 缺 stock', 'variants', $$'[{"id":"a","name":"n","price":1}]'::jsonb$$, '23514'),
  ('variants 缺 id', 'variants', $$'[{"name":"n","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('variants 缺 name', 'variants', $$'[{"id":"a","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('price 0', 'variants', $$'[{"id":"a","name":"n","price":0,"stock":1}]'::jsonb$$, '23514'),
  ('price 負數', 'variants', $$'[{"id":"a","name":"n","price":-5,"stock":1}]'::jsonb$$, '23514'),
  ('price 小數', 'variants', $$'[{"id":"a","name":"n","price":1.5,"stock":1}]'::jsonb$$, '23514'),
  ('price 字串', 'variants', $$'[{"id":"a","name":"n","price":"100","stock":1}]'::jsonb$$, '23514'),
  ('price null', 'variants', $$'[{"id":"a","name":"n","price":null,"stock":1}]'::jsonb$$, '23514'),
  ('price 500000', 'variants', $$'[{"id":"a","name":"n","price":500000,"stock":1}]'::jsonb$$, '23514'),
  ('price 1e400', 'variants', $$'[{"id":"a","name":"n","price":1e400,"stock":1}]'::jsonb$$, '23514'),
  ('price 布林', 'variants', $$'[{"id":"a","name":"n","price":true,"stock":1}]'::jsonb$$, '23514'),
  ('stock 負數', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":-1}]'::jsonb$$, '23514'),
  ('stock 小數', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1.5}]'::jsonb$$, '23514'),
  ('stock 字串', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":"5"}]'::jsonb$$, '23514'),
  ('stock 2147483648', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":2147483648}]'::jsonb$$, '23514'),
  ('多餘 key', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"isAdmin":true}]'::jsonb$$, '23514'),
  ('多餘 key（大小寫不同）', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"Price":1}]'::jsonb$$, '23514'),
  ('id 重複', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1},{"id":"a","name":"m","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('id 空字串', 'variants', $$'[{"id":"","name":"n","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('id 65 字', 'variants', $$jsonb_build_array(jsonb_build_object('id', repeat('a', 65), 'name', 'n', 'price', 1, 'stock', 1))$$, '23514'),
  ('id 是數字', 'variants', $$'[{"id":1,"name":"n","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('name 空字串', 'variants', $$'[{"id":"a","name":"","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('name 只有空白', 'variants', $$'[{"id":"a","name":"   ","price":1,"stock":1}]'::jsonb$$, '23514'),
  ('name 201 字', 'variants', $$jsonb_build_array(jsonb_build_object('id', 'a', 'name', repeat('字', 201), 'price', 1, 'stock', 1))$$, '23514'),
  ('name 是數字', 'variants', $$'[{"id":"a","name":5,"price":1,"stock":1}]'::jsonb$$, '23514'),
  ('originalPrice null', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":null}]'::jsonb$$, '23514'),
  ('originalPrice 小數', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":1.5}]'::jsonb$$, '23514'),
  ('originalPrice 負數', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":-1}]'::jsonb$$, '23514'),
  ('originalPrice 500000', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":500000}]'::jsonb$$, '23514'),
  ('originalPrice 字串', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":"9"}]'::jsonb$$, '23514'),
  ('sourceId 空字串', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"sourceId":""}]'::jsonb$$, '23514'),
  ('sourceId 33 字', 'variants', $$jsonb_build_array(jsonb_build_object('id', 'a', 'name', 'n', 'price', 1, 'stock', 1, 'sourceId', repeat('1', 33)))$$, '23514'),
  ('sourceId 是數字', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"sourceId":123}]'::jsonb$$, '23514'),
  ('sourceId null', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"sourceId":null}]'::jsonb$$, '23514'),
  ('variant image 空字串', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"image":""}]'::jsonb$$, '23514'),
  ('variant image 2049 字', 'variants', $$jsonb_build_array(jsonb_build_object('id', 'a', 'name', 'n', 'price', 1, 'stock', 1, 'image', repeat('x', 2049)))$$, '23514'),
  ('variant image null', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"image":null}]'::jsonb$$, '23514'),
  ('variant image 是物件', 'variants', $$'[{"id":"a","name":"n","price":1,"stock":1,"image":{"url":"x"}}]'::jsonb$$, '23514'),
  ('variants 201 個', 'variants', $$(select jsonb_agg(jsonb_build_object('id', 'v' || i, 'name', 'n', 'price', 1, 'stock', 1)) from generate_series(1, 201) i)$$, '23514'),
  -- variants：合格的邊界值
  ('variants 邊界：price 1／499999、stock 0／2147483647、originalPrice 0／499999', 'variants',
   $$'[{"id":"a","name":"n","price":1,"stock":0,"originalPrice":0},{"id":"b","name":"n2","price":499999,"stock":2147483647,"originalPrice":499999,"sourceId":"123","image":"https://example.test/i.jpg"}]'::jsonb$$, 'ok'),
  ('variants 邊界：200 個規格、id 64 字、name 200 字', 'variants',
   $$(select jsonb_agg(jsonb_build_object('id', case when i = 1 then repeat('a', 64) else 'v' || i end, 'name', repeat('字', 200), 'price', 1, 'stock', 1)) from generate_series(1, 200) i)$$, 'ok'),
  ('variants 邊界：整數寫成 5.0', 'variants', $$'[{"id":"a","name":"n","price":5.0,"stock":1.0}]'::jsonb$$, 'ok'),
  -- images：非法
  ('images 是物件', 'images', $$'{}'::jsonb$$, '23514'),
  ('images 是字串', 'images', $$'"https://x"'::jsonb$$, '23514'),
  ('images 是 json null', 'images', $$'null'::jsonb$$, '23514'),
  ('images 元素是數字', 'images', $$'[1]'::jsonb$$, '23514'),
  ('images 元素是 null', 'images', $$'[null]'::jsonb$$, '23514'),
  ('images 元素是物件', 'images', $$'[{"url":"https://x"}]'::jsonb$$, '23514'),
  ('images 元素空字串', 'images', $$'[""]'::jsonb$$, '23514'),
  ('images 10 張', 'images', $$(select jsonb_agg('https://example.test/' || i || '.jpg') from generate_series(1, 10) i)$$, '23514'),
  ('images data: 開頭', 'images', $$'["data:image/png;base64,AAAA"]'::jsonb$$, '23514'),
  ('images javascript: 開頭', 'images', $$'["javascript:alert(1)"]'::jsonb$$, '23514'),
  ('images ftp:// 開頭', 'images', $$'["ftp://example.test/a.jpg"]'::jsonb$$, '23514'),
  ('images 沒有協定', 'images', $$'["example.test/a.jpg"]'::jsonb$$, '23514'),
  ('images 前面有空白', 'images', $$'[" https://example.test/a.jpg"]'::jsonb$$, '23514'),
  ('images 2049 字', 'images', $$jsonb_build_array('https://example.test/' || repeat('a', 2028))$$, '23514'),
  ('images 好的混一個壞的', 'images', $$'["https://example.test/a.jpg", 5]'::jsonb$$, '23514'),
  -- images：合格的邊界值
  ('images 邊界：空陣列', 'images', $$'[]'::jsonb$$, 'ok'),
  ('images 邊界：9 張混合 https／http／art:', 'images',
   $$(select jsonb_agg(case i % 3 when 0 then 'https://example.test/' || i when 1 then 'http://example.test/' || i else 'art:🎧:#dbeafe:#93c5fd' end) from generate_series(1, 9) i)$$, 'ok'),
  ('images 邊界：2048 字', 'images', $$jsonb_build_array('https://example.test/' || repeat('a', 2027))$$, 'ok'),
  -- 文字欄位
  ('description 10001 字', 'description', $$repeat('字', 10001)$$, '23514'),
  ('description 邊界：10000 字', 'description', $$repeat('字', 10000)$$, 'ok'),
  ('description 空字串', 'description', $$''$$, 'ok'),
  ('location 21 字', 'location', $$repeat('a', 21)$$, '23514'),
  ('location 邊界：20 字', 'location', $$repeat('a', 20)$$, 'ok'),
  ('category_id 31 字', 'category_id', $$repeat('a', 31)$$, '23514'),
  ('category_id 邊界：30 字', 'category_id', $$repeat('a', 30)$$, 'ok');

do $$
declare
  c record;
  v_base_images constant text := $b$'["art:x:#fff:#000"]'::jsonb$b$;
  v_base_variants constant text := $b$'[{"id":"v1","name":"黑色","price":100,"stock":10}]'::jsonb$b$;
  v_row text;
  v_sql text;
begin
  for c in select * from pwh_t.cases loop
    -- insert：除了被測的欄位，其餘用合格的預設值
    v_sql := format($f$insert into public.products (shop_id, title, description, category_id, images, variants, location, status)
        select 'aaaaaaaa-1111-4111-8111-000000000001', '形狀測試商品', %s, %s, %s, %s, %s, 'active'$f$,
      case when c.col = 'description' then c.expr else '''d''' end,
      case when c.col = 'category_id' then c.expr else '''3c''' end,
      case when c.col = 'images' then c.expr else v_base_images end,
      case when c.col = 'variants' then c.expr else v_base_variants end,
      case when c.col = 'location' then c.expr else '''臺北市''' end);
    perform pwh_t.try('3', 'insert：' || c.label, c.expected, 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', v_sql,
                      case when c.expected = '23514' then 'violates check constraint' end);
    -- update：改的是 PA2（只受檢查，不影響別的測試）；update 成功後下一輪的 update 會從上一輪的值出發，所以每次都以完整值覆寫該欄
    v_sql := format($f$update public.products set %I = %s where id = 'aaaaaaaa-2222-4222-8222-000000000002'$f$, c.col, c.expr);
    perform pwh_t.try('3', 'update：' || c.label, case when c.expected = 'ok' then 'rows:1' else c.expected end,
                      'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', v_sql,
                      case when c.expected = '23514' then 'violates check constraint' end);
  end loop;
end $$;

-- update 之後把 PA2 還原成合格的內容（後面的測試要用）
update public.products set description = 'd', location = '臺北市', category_id = 'home', images = '["art:y:#fff:#000"]',
       variants = '[{"id":"w1","name":"標準款","price":1000,"stock":5}]' where id = 'aaaaaaaa-2222-4222-8222-000000000002';
delete from public.products where title = '形狀測試商品';

-- 違反的是哪一條約束（名稱要對得上）
select pwh_t.try('3', '約束名稱：variants', '23514', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set variants = '[]' where id = 'aaaaaaaa-2222-4222-8222-000000000002'$$, 'products_variants_shape_check');
select pwh_t.try('3', '約束名稱：images', '23514', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set images = '["javascript:x"]' where id = 'aaaaaaaa-2222-4222-8222-000000000002'$$, 'products_images_shape_check');
select pwh_t.try('3', '約束名稱：description', '23514', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update public.products set description = repeat('a', 10001) where id = 'aaaaaaaa-2222-4222-8222-000000000002'$$, 'products_description_len_check');
select pwh_t.try('3', 'postgres 身分也受 CHECK 約束', '23514', 'postgres', null,
  $$update public.products set variants = '[]' where id = 'aaaaaaaa-2222-4222-8222-000000000002'$$);

\echo
\echo '=== 3b. 檢查函式：immutable、search_path 固定、任何輸入都回 boolean 不丟例外 ==='
select pwh_t.check('3b', p.proname || '：immutable＋search_path 固定',
  p.provolatile = 'i' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), p.proconfig::text)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('products_jsonb_int_between', 'products_jsonb_text_len', 'products_variants_valid', 'products_images_valid');

do $$
declare
  inputs jsonb[] := array[
    'null', 'true', 'false', '0', '-1', '1e400', '-1e400', '1.5', '"x"', '""', '"1e999"', '"NaN"', '[]', '{}', '[null]', '[[]]', '[{}]',
    '[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]]', '{"a":{"b":{"c":[1,2,{"d":null}]}}}',
    '[{"id":"a","name":"n","price":1e400,"stock":1}]', '[{"id":"a","name":"n","price":"abc","stock":"def"}]',
    '[{"id":"a","name":"n","price":123456789012345678901234567890,"stock":-123456789012345678901234567890}]',
    '[{"id":null,"name":null,"price":null,"stock":null,"originalPrice":null,"sourceId":null,"image":null}]',
    '[{"id":[],"name":{},"price":[],"stock":{}}]', '["https://x", 1, null, [], {}]', '["art:"]', '["art:x"]', '["https://"]'
  ]::jsonb[];
  x jsonb; r boolean; i integer := 0; bad integer := 0;
begin
  foreach x in array inputs || array[null::jsonb] loop
    begin
      i := i + 1;
      r := public.products_variants_valid(x);
      if r is null then bad := bad + 1; end if;
      r := public.products_images_valid(x);
      if r is null then bad := bad + 1; end if;
      r := public.products_jsonb_int_between(x, 0, 10);
      if r is null then bad := bad + 1; end if;
      r := public.products_jsonb_text_len(x, 0, 10);
      if r is null then bad := bad + 1; end if;
    exception when others then
      bad := bad + 1;
      raise notice '函式對輸入 % 丟了例外：%', x, sqlerrm;
    end;
  end loop;
  perform pwh_t.check('3b', format('%s 個怪輸入（含 SQL NULL）四個函式都回 boolean、不丟例外', i), bad = 0, 'bad=' || bad);
end $$;

-- 把 PA1 還原成原本的內容（第 1 節的 update 改過它）
update public.products set title = '甲店商品一號測試', status = 'active',
  variants = '[{"id":"v1","name":"黑色","price":100,"stock":10,"originalPrice":200},{"id":"v2","name":"白色","price":100,"stock":0}]'
 where id = 'aaaaaaaa-2222-4222-8222-000000000001';

\echo
\echo '=== 4. 合法路徑 ==='

-- 4a. quick_edit_product（賣家甲）
select pwh_t.try('4a', '快改：售價 100→150', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.qe', public.quick_edit_product('aaaaaaaa-2222-4222-8222-000000000001',
      '[{"variantId":"v1","field":"price","value":150,"expected":100}]')::text, true)$$);
select pwh_t.check('4a', '快改回傳 outcome=ok 且資料庫價格是 150',
  current_setting('pwh.qe', true)::jsonb->>'outcome' = 'ok'
  and (select (variants->0->>'price')::int from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001') = 150,
  current_setting('pwh.qe', true));
select pwh_t.try('4a', '快改：原價 200→null（清空＝移除 key）', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.qe', public.quick_edit_product('aaaaaaaa-2222-4222-8222-000000000001',
      '[{"variantId":"v1","field":"original_price","value":null,"expected":200}]')::text, true)$$);
select pwh_t.check('4a', '清空原價後 variant 沒有 originalPrice key（不是 null 值）',
  current_setting('pwh.qe', true)::jsonb->>'outcome' = 'ok'
  and not (select variants->0 ? 'originalPrice' from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001'),
  current_setting('pwh.qe', true));
select pwh_t.try('4a', '快改：原價 null→300', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.qe', public.quick_edit_product('aaaaaaaa-2222-4222-8222-000000000001',
      '[{"variantId":"v1","field":"original_price","value":300,"expected":null}]')::text, true)$$);
select pwh_t.try('4a', '快改：兩個規格庫存都改 0 → 自動下架', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.qe', public.quick_edit_product('aaaaaaaa-2222-4222-8222-000000000001',
      '[{"variantId":"v1","field":"stock","value":0,"expected":10}]')::text, true)$$);
select pwh_t.check('4a', '自動下架：status=hidden、auto_hidden=true',
  (select status = 'hidden' and auto_hidden from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001'), current_setting('pwh.qe', true));
select pwh_t.try('4a', '快改：補貨 0→999999（快改上限）→ 自動上架', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.qe', public.quick_edit_product('aaaaaaaa-2222-4222-8222-000000000001',
      '[{"variantId":"v1","field":"stock","value":999999,"expected":0}]')::text, true)$$);
select pwh_t.check('4a', '自動上架：status=active、auto_hidden=false、庫存 999999',
  (select status = 'active' and not auto_hidden and (variants->0->>'stock')::int = 999999
     from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000001'), current_setting('pwh.qe', true));

-- 4b. import_products_batch（新增＋更新＋描述／名稱過長）
select pwh_t.try('4b', 'start_product_import', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select set_config('pwh.imp', public.start_product_import('shopee', jsonb_build_object('externalShopId', 'ext1',
      'files', '[{"kind":"basic_info","fileName":"a.xlsx"},{"kind":"sales_info","fileName":"b.xlsx"},{"kind":"media_info","fileName":"c.xlsx"}]'::jsonb,
      'totalProducts', 20, 'skipped', 0, 'options', '{"skipSoldOut":false,"allHidden":false}'::jsonb))->>'importId', true)$$);

create function pwh_t.imp_item(p_sid text, p_desc text, p_vname text, p_price int, p_stock numeric)
returns jsonb language sql as $$
  select jsonb_build_object('sourceProductId', p_sid, 'title', '匯入測試商品' || p_sid, 'description', p_desc,
    'categoryId', '3c', 'status', 'active',
    'images', jsonb_build_array(jsonb_build_object('url', 'http://127.0.0.1:55321/storage/v1/object/public/product-images/aaaaaaaa-1111-4111-8111-000000000001/p' || p_sid || '.jpg',
                                                    'sourceUrl', 'https://down-tw.img.susercontent.com/file/p' || p_sid)),
    'variants', jsonb_build_array(
      jsonb_build_object('sourceVariantId', '9' || p_sid, 'name', p_vname, 'price', p_price, 'stock', p_stock,
        'image', jsonb_build_object('url', 'http://127.0.0.1:55321/storage/v1/object/public/product-images/aaaaaaaa-1111-4111-8111-000000000001/v' || p_sid || '.jpg',
                                    'sourceUrl', 'https://down-tw.img.susercontent.com/file/v' || p_sid)),
      jsonb_build_object('sourceVariantId', '8' || p_sid, 'name', '無圖規格', 'price', 20, 'stock', 0)));
$$;

select pwh_t.try('4b', '匯入新增 2 件（描述剛好 10000 字的一件）', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$select set_config('pwh.res', public.import_products_batch(current_setting('pwh.imp', true), jsonb_build_array(
      pwh_t.imp_item('1001', '短描述', '紅色', 100, 5), pwh_t.imp_item('1002', repeat('字', 10000), '藍色', 200, 2147483647)),
      '{"clientFailures":[],"skippedImages":[]}'::jsonb)::text, true)$f$));
select pwh_t.check('4b', '兩件都 created', (select count(*) from jsonb_array_elements(current_setting('pwh.res', true)::jsonb->'results') r where r->>'outcome' = 'created') = 2,
  current_setting('pwh.res', true));
select pwh_t.check('4b', '新增的規格：key 都在白名單、沒有 null 值、沒有 originalPrice',
  (select bool_and(not exists (select 1 from jsonb_each(v) kv where jsonb_typeof(kv.value) = 'null')
                   and not exists (select 1 from jsonb_object_keys(v) k where k not in ('id','name','price','stock','sourceId','image')))
     from public.products p, jsonb_array_elements(p.variants) v where p.source = 'shopee' and p.source_product_id in ('1001', '1002')));

select pwh_t.try('4b', '匯入更新（改價、改庫存、新增一個規格來源 id）', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$select set_config('pwh.res', public.import_products_batch(current_setting('pwh.imp', true), jsonb_build_array(
      pwh_t.imp_item('1001', '新描述', '紅色', 110, 7)), '{"clientFailures":[],"skippedImages":[]}'::jsonb)::text, true)$f$));
select pwh_t.check('4b', '更新結果 updated、價格 110、庫存 7',
  (current_setting('pwh.res', true)::jsonb->'results'->0->>'outcome') = 'updated'
  and (select (variants->0->>'price')::int = 110 and (variants->0->>'stock')::int = 7 from public.products where source = 'shopee' and source_product_id = '1001'),
  current_setting('pwh.res', true));
-- 賣家手動設了原價之後再匯入更新：原價仍高於新售價才保留
update public.products set variants = jsonb_set(variants, '{0,originalPrice}', '500') where source = 'shopee' and source_product_id = '1001';
select pwh_t.try('4b', '匯入更新（保留手動設的原價）', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$select set_config('pwh.res', public.import_products_batch(current_setting('pwh.imp', true), jsonb_build_array(
      pwh_t.imp_item('1001', '新描述', '紅色', 120, 7)), '{"clientFailures":[],"skippedImages":[]}'::jsonb)::text, true)$f$));
select pwh_t.check('4b', '保留的原價是 500（整數）',
  (select (variants->0->>'originalPrice')::int = 500 from public.products where source = 'shopee' and source_product_id = '1001'), current_setting('pwh.res', true));

-- (b) 描述 10001 字、規格名稱 201 字：這兩件各自失敗（INTERNAL＋原始錯誤訊息），其餘不受影響
select pwh_t.try('4b', '匯入：描述 10001 字＋名稱 201 字＋正常的一件同批', 'ok', 'authenticated', 'aaaaaaaa-0000-4000-8000-000000000001',
  format($f$select set_config('pwh.res', public.import_products_batch(current_setting('pwh.imp', true), jsonb_build_array(
      pwh_t.imp_item('1003', repeat('字', 10001), '黃色', 100, 5), pwh_t.imp_item('1004', 'ok', repeat('名', 201), 100, 5),
      pwh_t.imp_item('1005', 'ok', '綠色', 100, 5)), '{"clientFailures":[],"skippedImages":[]}'::jsonb)::text, true)$f$));
select pwh_t.check('4b', '描述過長：outcome=failed、code=INTERNAL、message 帶約束名稱、沒有留下商品',
  (current_setting('pwh.res', true)::jsonb->'results'->0->>'outcome') = 'failed'
  and (current_setting('pwh.res', true)::jsonb->'results'->0->'errors'->0->>'code') = 'INTERNAL'
  and (current_setting('pwh.res', true)::jsonb->'results'->0->'errors'->0->>'message') like '%products_description_len_check%'
  and not exists (select 1 from public.products where source_product_id = '1003'),
  (current_setting('pwh.res', true)::jsonb->'results'->0)::text);
select pwh_t.check('4b', '名稱過長：outcome=failed、message 帶 products_variants_shape_check',
  (current_setting('pwh.res', true)::jsonb->'results'->1->>'outcome') = 'failed'
  and (current_setting('pwh.res', true)::jsonb->'results'->1->'errors'->0->>'message') like '%products_variants_shape_check%'
  and not exists (select 1 from public.products where source_product_id = '1004'),
  (current_setting('pwh.res', true)::jsonb->'results'->1)::text);
select pwh_t.check('4b', '同批第三件正常 created', (current_setting('pwh.res', true)::jsonb->'results'->2->>'outcome') = 'created', current_setting('pwh.res', true));

-- 4c. place_checked_order（買家丙，貨到付款）＋回補
select pwh_t.try('4c', '下單 PA2×2（貨到付款，免運）', 'ok', 'authenticated', 'cccccccc-0000-4000-8000-000000000001',
  $$select set_config('pwh.ord', public.place_checked_order(
      '[{"productId":"aaaaaaaa-2222-4222-8222-000000000002","variantId":"w1","qty":2,"price":1000}]'::jsonb,
      '{"name":"丙","phone":"0912345678","address":"台北市測試路 1 號"}'::jsonb, 'cod', false,
      '{"aaaaaaaa-1111-4111-8111-000000000001":0}'::jsonb)::text, true)$$);
select pwh_t.check('4c', '下單成功：庫存 5→3、sold 2、variants 形狀仍合格',
  current_setting('pwh.ord', true)::jsonb->>'outcome' = 'ok'
  and (select (variants->0->>'stock')::int = 3 and sold = 2 and pwh_t.variants_valid(variants)
         from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'), current_setting('pwh.ord', true));
select pwh_t.try('4c', '庫存不足 → rejected（不是錯誤）', 'ok', 'authenticated', 'cccccccc-0000-4000-8000-000000000001',
  $$select set_config('pwh.ord2', public.place_checked_order(
      '[{"productId":"aaaaaaaa-2222-4222-8222-000000000002","variantId":"w1","qty":4,"price":1000}]'::jsonb,
      '{"name":"丙","phone":"0912345678","address":"台北市測試路 1 號"}'::jsonb, 'cod', false,
      '{"aaaaaaaa-1111-4111-8111-000000000001":0}'::jsonb)::text, true)$$);
select pwh_t.check('4c', '庫存不足回 rejected，庫存不變',
  current_setting('pwh.ord2', true)::jsonb->>'outcome' = 'rejected'
  and (select (variants->0->>'stock')::int = 3 from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'), current_setting('pwh.ord2', true));

-- 取消回補：_order_restock（已付款退款路徑呼叫）、_online_order_release（線上付款逾時／失敗路徑呼叫）
select pwh_t.try('4c', '_order_restock：庫存 3→5、sold 2→0', 'ok', 'postgres', null,
  $$select public._order_restock((current_setting('pwh.ord', true)::jsonb->'orders'->0->>'id')::uuid)$$);
select pwh_t.check('4c', '回補後庫存 5、sold 0、形狀合格',
  (select (variants->0->>'stock')::int = 5 and sold = 0 and pwh_t.variants_valid(variants)
     from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'));

update public.products set variants = jsonb_set(variants, '{0,stock}', '3'), sold = 2 where id = 'aaaaaaaa-2222-4222-8222-000000000002';
update public.orders set payment_status = 'pending' where id = (current_setting('pwh.ord', true)::jsonb->'orders'->0->>'id')::uuid;
select pwh_t.try('4c', '_online_order_release：庫存 3→5', 'ok', 'postgres', null,
  $$select set_config('pwh.rel', public._online_order_release((current_setting('pwh.ord', true)::jsonb->'orders'->0->>'id')::uuid, 'failed')::text, true)$$);
select pwh_t.check('4c', '釋放後庫存 5、sold 0、訂單 cancelled',
  current_setting('pwh.rel', true) = 'true'
  and (select (variants->0->>'stock')::int = 5 and sold = 0 from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002')
  and (select status from public.orders where id = (current_setting('pwh.ord', true)::jsonb->'orders'->0->>'id')::uuid) = 'cancelled');

-- (a) 回補後庫存超過上限：下單時庫存是 2147483647，之後賣家又把庫存補回上限，這時取消的回補（integer 加法）會先溢位（22003），
--     整個函式回滾；CHECK 不會是先失敗的那個
update public.products set variants = jsonb_set(variants, '{0,stock}', '2147483647') where id = 'aaaaaaaa-2222-4222-8222-000000000002';
select pwh_t.try('4c', '庫存 2147483647 時下單 2 件', 'ok', 'authenticated', 'cccccccc-0000-4000-8000-000000000001',
  $$select set_config('pwh.ord3', public.place_checked_order(
      '[{"productId":"aaaaaaaa-2222-4222-8222-000000000002","variantId":"w1","qty":2,"price":1000}]'::jsonb,
      '{"name":"丙","phone":"0912345678","address":"台北市測試路 1 號"}'::jsonb, 'cod', false,
      '{"aaaaaaaa-1111-4111-8111-000000000001":0}'::jsonb)::text, true)$$);
select pwh_t.check('4c', '(a) 下單後庫存 2147483645（上限附近的扣庫存不會出錯）',
  (select (variants->0->>'stock')::bigint = 2147483645 from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'), current_setting('pwh.ord3', true));
update public.products set variants = jsonb_set(variants, '{0,stock}', '2147483647') where id = 'aaaaaaaa-2222-4222-8222-000000000002';
select pwh_t.try('4c', '(a) 庫存 2147483647 再回補 2 件 → integer 溢位 22003（既有行為，非 CHECK）', '22003', 'postgres', null,
  $$select public._order_restock((current_setting('pwh.ord3', true)::jsonb->'orders'->0->>'id')::uuid)$$);
select pwh_t.check('4c', '(a) 溢位後庫存維持 2147483647（整個函式回滾）',
  (select (variants->0->>'stock')::bigint = 2147483647 from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'));
update public.products set variants = jsonb_set(variants, '{0,stock}', '2147483645') where id = 'aaaaaaaa-2222-4222-8222-000000000002';
select pwh_t.try('4c', '(a) 庫存 2147483645 回補 2 件 → 剛好 2147483647 通過 CHECK', 'ok', 'postgres', null,
  $$select public._order_restock((current_setting('pwh.ord3', true)::jsonb->'orders'->0->>'id')::uuid)$$);
select pwh_t.check('4c', '(a) 回補後庫存 2147483647',
  (select (variants->0->>'stock')::bigint = 2147483647 from public.products where id = 'aaaaaaaa-2222-4222-8222-000000000002'));

-- ──────────────────────────── 現況輸出 ────────────────────────────
\echo
\echo '=== 權限現況（information_schema） ==='
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as table_privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'products' and grantee in ('anon', 'authenticated', 'service_role')
 group by grantee order by grantee;
select grantee, privilege_type, string_agg(column_name, ', ' order by column_name) as columns
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'products' and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE')
 group by grantee, privilege_type order by grantee, privilege_type;
select a.attname as col,
       has_column_privilege('anon', 'public.products', a.attname, 'SELECT') as anon_select,
       has_column_privilege('anon', 'public.products', a.attname, 'INSERT') as anon_insert,
       has_column_privilege('anon', 'public.products', a.attname, 'UPDATE') as anon_update,
       has_column_privilege('authenticated', 'public.products', a.attname, 'SELECT') as auth_select,
       has_column_privilege('authenticated', 'public.products', a.attname, 'INSERT') as auth_insert,
       has_column_privilege('authenticated', 'public.products', a.attname, 'UPDATE') as auth_update
  from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum;

select pwh_t.check('1', 'has_column_privilege：九欄可寫、其餘七欄不可寫（authenticated）',
  (select bool_and((a.attname = any (array['shop_id','title','description','category_id','images','variants','free_shipping','location','status']))
                   = (has_column_privilege('authenticated', 'public.products', a.attname, 'INSERT')
                      and has_column_privilege('authenticated', 'public.products', a.attname, 'UPDATE')))
     from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped));
select pwh_t.check('1', 'anon 任何欄位都不可寫',
  (select bool_and(not has_column_privilege('anon', 'public.products', a.attname, 'INSERT')
                   and not has_column_privilege('anon', 'public.products', a.attname, 'UPDATE'))
     from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped));

\echo
\echo '=== 約束現況 ==='
select conname, convalidated, pg_get_constraintdef(oid) as def from pg_constraint
 where conrelid = 'public.products'::regclass and contype = 'c' order by conname;
select pwh_t.check('3', '五條新約束都存在且 validated（全新資料庫，含 seed 的 24 筆商品）',
  (select count(*) from pg_constraint where conrelid = 'public.products'::regclass and convalidated
      and conname in ('products_images_shape_check','products_variants_shape_check','products_description_len_check',
                      'products_location_len_check','products_category_len_check')) = 5);

\echo
\echo '=== 測試結果（失敗的列在最上面） ==='
select grp, label, expected, got, ok, detail from pwh_t.results where not ok order by n;
select grp, count(*) as total, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed
  from pwh_t.results group by grp order by grp;
\echo
\echo '=== 全部明細 ==='
select n, grp, label, expected, got, case when ok then 'PASS' else 'FAIL' end as result, detail from pwh_t.results order by n;

do $$
declare f integer;
begin
  select count(*) into f from pwh_t.results where not ok;
  if f > 0 then raise exception '有 % 項測試失敗', f; end if;
  raise notice '全部 % 項通過', (select count(*) from pwh_t.results);
end $$;

rollback;
