-- products 資料形狀檢查：套用前的唯讀盤點（只有 SELECT；整支是單一指令，回一欄 JSON）
--
-- 用法（正式站唯讀）：
--   npx supabase db query --linked --read-only -f supabase/ops/products-write-hardening/precheck.sql
-- 輸出（stdout 開頭有一行 `Initialising login role...`，解析時先切到第一個 `{`）：
--   total_products           現有商品數
--   violating_products       至少違反一條檢查的商品數（0 ＝ migration 裡的 VALIDATE 會全部通過）
--   counts_by_reason         每個原因各有幾件商品
--   shops_with_location_over_20  location 超過 20 字的店數（商品的 location 取自店；超過會讓該店的商品寫入被檢查擋下）
--   violations               違規商品的 id／shop_id／原因，最多 200 筆；violations_truncated 為 true 表示不只 200 筆
-- 規則與 migration 20261111120000_products_write_hardening.sql 的檢查函式一致；這裡不用那些函式（套用前它們還不存在），
-- 並且對任何形狀的資料都不會丟例外。

with
p as (
  select id, shop_id, variants, images, description, location, category_id from public.products
),
-- 每個 variants 元素；eo＝非物件時換成空物件，讓後面的 key 檢查不會對純量丟例外
ve as (
  select p.id, p.shop_id, t.e,
         case when jsonb_typeof(t.e) = 'object' then t.e else '{}'::jsonb end as eo,
         jsonb_typeof(t.e) = 'object' as is_obj
    from p,
         lateral jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) as t(e)
),
ie as (
  select p.id, p.shop_id, t.e
    from p,
         lateral jsonb_array_elements(case when jsonb_typeof(p.images) = 'array' then p.images else '[]'::jsonb end) as t(e)
),
issues(id, shop_id, reason) as (
  select id, shop_id, 'variants_not_array' from p where jsonb_typeof(variants) is distinct from 'array'
  union all
  select id, shop_id, 'variants_count_out_of_range' from p
   where case when jsonb_typeof(variants) = 'array' then jsonb_array_length(variants) not between 1 and 200 else false end
  union all
  select id, shop_id, 'variant_not_object' from ve where not is_obj
  union all
  select id, shop_id, 'variant_unknown_key' from ve
   where is_obj and exists (select 1 from jsonb_object_keys(eo) k
                             where k not in ('id', 'name', 'price', 'stock', 'originalPrice', 'sourceId', 'image'))
  union all
  select id, shop_id, 'variant_id_invalid' from ve
   where is_obj and not (jsonb_typeof(eo->'id') = 'string' and char_length(eo->>'id') between 1 and 64)
  union all
  select id, shop_id, 'variant_id_duplicate' from ve
   where is_obj and jsonb_typeof(eo->'id') = 'string'
   group by id, shop_id, eo->>'id' having count(*) > 1
  union all
  select id, shop_id, 'variant_name_invalid' from ve
   where is_obj and not (jsonb_typeof(eo->'name') = 'string' and char_length(eo->>'name') between 1 and 200 and btrim(eo->>'name') <> '')
  union all
  select id, shop_id, 'variant_price_invalid' from ve
   where is_obj and not case when jsonb_typeof(eo->'price') = 'number'
            then (eo->>'price') ~ '^[0-9]{1,10}$' and (eo->>'price')::numeric between 1 and 499999
            else false end
  union all
  select id, shop_id, 'variant_stock_invalid' from ve
   where is_obj and not case when jsonb_typeof(eo->'stock') = 'number'
            then (eo->>'stock') ~ '^[0-9]{1,10}$' and (eo->>'stock')::numeric between 0 and 2147483647
            else false end
  union all
  select id, shop_id, 'variant_original_price_invalid' from ve
   where is_obj and eo ? 'originalPrice' and not case when jsonb_typeof(eo->'originalPrice') = 'number'
            then (eo->>'originalPrice') ~ '^[0-9]{1,10}$' and (eo->>'originalPrice')::numeric between 0 and 499999
            else false end
  union all
  select id, shop_id, 'variant_source_id_invalid' from ve
   where is_obj and eo ? 'sourceId' and not (jsonb_typeof(eo->'sourceId') = 'string' and char_length(eo->>'sourceId') between 1 and 32)
  union all
  select id, shop_id, 'variant_image_invalid' from ve
   where is_obj and eo ? 'image' and not (jsonb_typeof(eo->'image') = 'string' and char_length(eo->>'image') between 1 and 2048)
  union all
  select id, shop_id, 'images_not_array' from p where jsonb_typeof(images) is distinct from 'array'
  union all
  select id, shop_id, 'images_count_over_9' from p where case when jsonb_typeof(images) = 'array' then jsonb_array_length(images) > 9 else false end
  union all
  select id, shop_id, 'image_invalid' from ie
   where not coalesce(jsonb_typeof(e) = 'string' and char_length(e #>> '{}') between 1 and 2048
                      and (e #>> '{}') ~ '^(https://|http://|art:)', false)
  union all
  select id, shop_id, 'description_over_10000' from p where char_length(description) > 10000
  union all
  select id, shop_id, 'location_over_20' from p where char_length(location) > 20
  union all
  select id, shop_id, 'category_id_over_30' from p where char_length(category_id) > 30
)
select jsonb_build_object(
  'kind', 'products_write_hardening_precheck',
  'total_products', (select count(*) from p),
  'violating_products', (select count(distinct id) from issues),
  'counts_by_reason', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(distinct id) as n from issues group by reason) c), '{}'::jsonb),
  'shops_with_location_over_20', (select count(*) from public.shops where char_length(location) > 20),
  'violations_truncated', (select count(distinct id) > 200 from issues),
  'violations', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'shop_id', shop_id, 'reasons', reasons) order by id)
      from (select id, shop_id, jsonb_agg(distinct reason) as reasons from issues group by id, shop_id order by id limit 200) x
  ), '[]'::jsonb)
) as precheck;
