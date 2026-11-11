-- VALIDATE 失敗情境（步驟 1／3）：在「還沒有新約束」的資料庫塞一批形狀不合的列，由 run-products-write-hardening.sh 接著
--   跑 precheck → 套 migration → 跑 products_write_hardening_validate_check.sql → 清掉這批資料 → 再套 migration。
-- 這支只在隔離的本機實例用（以 postgres 身分寫入）。

begin;
-- 舊的「圖片最多 9 張」約束會擋掉『十張圖』這筆壞列；只在隔離實例，rollback.sql 之後會再加回來
alter table public.products drop constraint if exists products_images_max_check;
insert into auth.users (id, instance_id, aud, role, email) values
  ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pwh-d@example.test');
insert into public.shops (id, owner_id, name, location) values
  ('dddddddd-1111-4111-8111-000000000001', 'dddddddd-0000-4000-8000-000000000001', '驗證店丁', '高雄市');

insert into public.products (id, shop_id, title, description, category_id, images, variants, location, status) values
  ('dddddddd-2222-4222-8222-000000000000', 'dddddddd-1111-4111-8111-000000000001', '合格商品基準列', 'd', '3c', '["art:x:#fff:#000"]',
   '[{"id":"v1","name":"預設","price":10,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000001', 'dddddddd-1111-4111-8111-000000000001', '壞列一號 variants 物件', 'd', '3c', '[]', '{}', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000002', 'dddddddd-1111-4111-8111-000000000001', '壞列二號 variants 空', 'd', '3c', '[]', '[]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000003', 'dddddddd-1111-4111-8111-000000000001', '壞列三號 price 零', 'd', '3c', '[]', '[{"id":"a","name":"n","price":0,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000004', 'dddddddd-1111-4111-8111-000000000001', '壞列四號 多餘 key', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1,"x":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000005', 'dddddddd-1111-4111-8111-000000000001', '壞列五號 id 重複', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1},{"id":"a","name":"m","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000006', 'dddddddd-1111-4111-8111-000000000001', '壞列六號 images 字串', 'd', '3c', '"x"', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000007', 'dddddddd-1111-4111-8111-000000000001', '壞列七號 十張圖', 'd', '3c',
   (select jsonb_agg('https://example.test/' || i) from generate_series(1, 10) i), '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000008', 'dddddddd-1111-4111-8111-000000000001', '壞列八號 圖片協定', 'd', '3c', '["data:image/png;base64,AAAA"]', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000009', 'dddddddd-1111-4111-8111-000000000001', '壞列九號 描述過長', repeat('a', 10001), '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000010', 'dddddddd-1111-4111-8111-000000000001', '壞列十號 location', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1}]', repeat('a', 21), 'active'),
  ('dddddddd-2222-4222-8222-000000000011', 'dddddddd-1111-4111-8111-000000000001', '壞列十一號 category', 'd', repeat('c', 31), '[]', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000012', 'dddddddd-1111-4111-8111-000000000001', '壞列十二號 圖片元素', 'd', '3c', '["https://example.test/a", 5]', '[{"id":"a","name":"n","price":1,"stock":1}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000013', 'dddddddd-1111-4111-8111-000000000001', '壞列十三號 原價 null', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1,"originalPrice":null}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000014', 'dddddddd-1111-4111-8111-000000000001', '壞列十四號 名稱過長', 'd', '3c', '[]', jsonb_build_array(jsonb_build_object('id','a','name',repeat('字',201),'price',1,'stock',1)), '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000015', 'dddddddd-1111-4111-8111-000000000001', '壞列十五號 元素非物件', 'd', '3c', '[]', '[5, null, "x"]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000016', 'dddddddd-1111-4111-8111-000000000001', '壞列十六號 庫存字串', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":"5"}]', '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000017', 'dddddddd-1111-4111-8111-000000000001', '壞列十七號 id 與來源', 'd', '3c', '[]',
   jsonb_build_array(jsonb_build_object('id','','name','n','price',1,'stock',1,'sourceId',repeat('1',33))), '高雄市', 'active'),
  ('dddddddd-2222-4222-8222-000000000018', 'dddddddd-1111-4111-8111-000000000001', '壞列十八號 規格圖', 'd', '3c', '[]', '[{"id":"a","name":"n","price":1,"stock":1,"image":5}]', '高雄市', 'active');
commit;
