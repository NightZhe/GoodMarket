-- products 寫入收斂：還原到套用 20261111120000_products_write_hardening.sql 之前的狀態
--
-- 用法：npx supabase db query --linked -f supabase/ops/products-write-hardening/rollback.sql
-- 會做的事（單一交易，任何一步失敗就整個回滾；可重複執行）：
--   1. 還原權限：anon、authenticated 對 products 回到 GRANT ALL（套用前的樣子）
--   2. 移除五條新約束與四個檢查函式
--   3. 恢復舊的 products_images_max_check（商品圖最多 9 張；非陣列放行），以 NOT VALID 加上（與 20261015010000 當初加上的方式相同）
-- 不會動：RLS policy、資料、其他表。
-- 還原後要再套 migration 時，直接重跑 20261111120000_products_write_hardening.sql。

begin;
set local lock_timeout = '10s';

alter table public.products drop constraint if exists products_images_shape_check;
alter table public.products drop constraint if exists products_variants_shape_check;
alter table public.products drop constraint if exists products_description_len_check;
alter table public.products drop constraint if exists products_location_len_check;
alter table public.products drop constraint if exists products_category_len_check;

drop function if exists public.products_variants_valid(jsonb);
drop function if exists public.products_images_valid(jsonb);
drop function if exists public.products_jsonb_text_len(jsonb, integer, integer);
drop function if exists public.products_jsonb_int_between(jsonb, numeric, numeric);

revoke all on table public.products from anon, authenticated;
grant all on table public.products to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_images_max_check' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_images_max_check
      check (jsonb_typeof(images) <> 'array' or jsonb_array_length(images) <= 9) not valid;
  end if;
end $$;

commit;
