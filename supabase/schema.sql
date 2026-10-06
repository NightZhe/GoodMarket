-- 好物集 GoodMarket — Supabase 資料結構與權限規則
-- 用法：Supabase 後台 → SQL Editor → 貼上整份 → Run（可重複執行）
--
-- 權限設計重點：
-- 1. 商品與商店：任何人都能讀（前台要看得到），只有店主能改自己的。
-- 2. 訂單：含收件人姓名電話地址，絕對不能讓所有人讀。
--    賣家只能讀自己店的訂單；買家沒有帳號，靠下單時拿到的 access_token 讀自己那筆。
-- 3. 下單：走 place_order 函式，才能在同一個交易裡扣庫存，避免超賣。

-- ──────────────────────────── 資料表 ────────────────────────────

create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  -- 平台示範商店的 owner_id 是 null，沒有人能編輯；真實賣家開的店會綁到自己的帳號
  owner_id    uuid references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 20),
  avatar      text not null default '🏪',
  description text not null default '',
  location    text not null default '臺北市',
  rating      numeric(2,1) not null default 5.0,
  created_at  timestamptz not null default now()
);

-- 一個帳號一家店
create unique index if not exists shops_owner_unique on public.shops (owner_id) where owner_id is not null;

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  title          text not null check (char_length(title) between 5 and 60),
  description    text not null default '',
  category_id    text not null,
  images         jsonb not null default '[]'::jsonb,
  -- [{ id, name, price, stock }]
  variants       jsonb not null default '[]'::jsonb,
  original_price integer,
  sold           integer not null default 0,
  rating         numeric(2,1) not null default 5.0,
  location       text not null default '臺北市',
  free_shipping  boolean not null default false,
  status         text not null default 'active' check (status in ('active', 'hidden')),
  created_at     timestamptz not null default now()
);

create index if not exists products_shop_idx on public.products (shop_id);
create index if not exists products_status_idx on public.products (status);

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  -- 買家沒有帳號，用這把 token 回來查自己的訂單
  access_token  text not null default encode(gen_random_bytes(16), 'hex'),
  -- [{ productId, variantId, title, variantName, image, price, qty }]
  lines         jsonb not null,
  shipping_fee  integer not null default 0,
  total         integer not null,
  status        text not null default 'to_ship' check (status in ('to_ship', 'shipping', 'completed', 'cancelled')),
  buyer_name    text not null,
  buyer_phone   text not null,
  buyer_address text not null,
  payment       text not null check (payment in ('cod', 'card', 'transfer')),
  created_at    timestamptz not null default now()
);

create index if not exists orders_shop_idx on public.orders (shop_id);

-- ──────────────────────────── 權限規則（RLS）────────────────────────────

alter table public.shops    enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- 商店：大家都能看；登入者只能建立／修改自己的店
drop policy if exists shops_read on public.shops;
create policy shops_read on public.shops for select using (true);

drop policy if exists shops_insert_own on public.shops;
create policy shops_insert_own on public.shops for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists shops_update_own on public.shops;
create policy shops_update_own on public.shops for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 商品：上架中的大家都看得到；下架的只有店主看得到；只有店主能改
drop policy if exists products_read on public.products;
create policy products_read on public.products for select using (
  status = 'active'
  or exists (select 1 from public.shops s where s.id = products.shop_id and s.owner_id = auth.uid())
);

drop policy if exists products_write_own on public.products;
create policy products_write_own on public.products for all to authenticated
  using (exists (select 1 from public.shops s where s.id = products.shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.shops s where s.id = products.shop_id and s.owner_id = auth.uid()));

-- 訂單：只有該店店主讀得到（含買家個資）。買家走 get_my_orders 函式，沒有直接讀取權限。
drop policy if exists orders_read_own_shop on public.orders;
create policy orders_read_own_shop on public.orders for select to authenticated using (
  exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid())
);

drop policy if exists orders_update_own_shop on public.orders;
create policy orders_update_own_shop on public.orders for update to authenticated
  using (exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()));

-- 刻意不開放任何人 insert：下單一律走 place_order()

-- ──────────────────────────── 下單 ────────────────────────────

-- 同一個交易裡：檢查庫存 → 扣庫存 → 建訂單，避免超賣。
-- p_items: [{ productId, variantId, qty }]
-- p_buyer: { name, phone, address }
create or replace function public.place_order(p_items jsonb, p_buyer jsonb, p_payment text)
returns table (id uuid, access_token text, shop_id uuid, lines jsonb, shipping_fee integer, total integer, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_variant     jsonb;
  v_idx         integer;
  v_qty         integer;
  v_shop        uuid;
  v_lines       jsonb;
  v_subtotal    integer;
  v_shipping    integer;
  v_all_free    boolean;
  v_order       public.orders%rowtype;
begin
  if p_payment not in ('cod', 'card', 'transfer') then
    raise exception '付款方式不正確';
  end if;
  if coalesce(p_buyer->>'name', '') = '' or coalesce(p_buyer->>'phone', '') = ''
     or coalesce(p_buyer->>'address', '') = '' then
    raise exception '收件資訊不完整';
  end if;

  create temp table if not exists _order_shops (shop_id uuid primary key, lines jsonb, subtotal integer, all_free boolean) on commit drop;
  delete from _order_shops;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));

    select * into v_product from public.products
      where id = (v_item->>'productId')::uuid and status = 'active' for update;
    if not found then
      raise exception '商品不存在或已下架';
    end if;

    -- 找出這個規格在 variants 陣列裡的位置
    select ord - 1, value into v_idx, v_variant
      from jsonb_array_elements(v_product.variants) with ordinality as t(value, ord)
      where value->>'id' = v_item->>'variantId';
    if v_idx is null then
      raise exception '規格不存在';
    end if;
    if (v_variant->>'stock')::integer < v_qty then
      raise exception '「%」的庫存不足，只剩 % 件', v_product.title, (v_variant->>'stock')::integer;
    end if;

    -- 扣庫存、累加銷量
    update public.products set
      variants = jsonb_set(variants, array[v_idx::text, 'stock'],
                           to_jsonb((v_variant->>'stock')::integer - v_qty)),
      sold = sold + v_qty
    where id = v_product.id;

    -- 依商店分組累積明細
    insert into _order_shops (shop_id, lines, subtotal, all_free)
    values (
      v_product.shop_id,
      jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'variantId', v_variant->>'id',
        'title', v_product.title, 'variantName', v_variant->>'name',
        'image', coalesce(v_product.images->>0, ''),
        'price', (v_variant->>'price')::integer, 'qty', v_qty
      )),
      (v_variant->>'price')::integer * v_qty,
      v_product.free_shipping
    )
    on conflict (shop_id) do update set
      lines = _order_shops.lines || excluded.lines,
      subtotal = _order_shops.subtotal + excluded.subtotal,
      all_free = _order_shops.all_free and excluded.all_free;
  end loop;

  -- 每家店開一張單：同店滿 499 免運，或該店這批商品都標免運
  for v_shop, v_lines, v_subtotal, v_all_free in select s.shop_id, s.lines, s.subtotal, s.all_free from _order_shops s loop
    v_shipping := case when v_subtotal >= 499 or v_all_free then 0 else 60 end;

    insert into public.orders (shop_id, lines, shipping_fee, total, buyer_name, buyer_phone, buyer_address, payment)
    values (v_shop, v_lines, v_shipping, v_subtotal + v_shipping,
            p_buyer->>'name', p_buyer->>'phone', p_buyer->>'address', p_payment)
    returning * into v_order;

    id := v_order.id; access_token := v_order.access_token; shop_id := v_order.shop_id;
    lines := v_order.lines; shipping_fee := v_order.shipping_fee; total := v_order.total;
    created_at := v_order.created_at;
    return next;
  end loop;
end $$;

grant execute on function public.place_order(jsonb, jsonb, text) to anon, authenticated;

-- ──────────────────────────── 買家查自己的訂單 ────────────────────────────

-- 買家沒有帳號，憑下單時拿到的 (id, token) 回來查。token 對不上就查不到。
-- p_keys: [{ id, token }]
create or replace function public.get_my_orders(p_keys jsonb)
returns table (id uuid, shop_id uuid, lines jsonb, shipping_fee integer, total integer,
               status text, payment text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select o.id, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment, o.created_at
  from public.orders o
  join jsonb_array_elements(p_keys) k on (k->>'id')::uuid = o.id and k->>'token' = o.access_token
  order by o.created_at desc;
$$;

grant execute on function public.get_my_orders(jsonb) to anon, authenticated;

-- 買家取消自己的未出貨訂單
create or replace function public.cancel_my_order(p_id uuid, p_token text)
returns void language sql security definer set search_path = public as $$
  update public.orders set status = 'cancelled'
  where id = p_id and access_token = p_token and status = 'to_ship';
$$;

grant execute on function public.cancel_my_order(uuid, text) to anon, authenticated;

-- 買家確認收貨
create or replace function public.complete_my_order(p_id uuid, p_token text)
returns void language sql security definer set search_path = public as $$
  update public.orders set status = 'completed'
  where id = p_id and access_token = p_token and status = 'shipping';
$$;

grant execute on function public.complete_my_order(uuid, text) to anon, authenticated;

-- ──────────────────────────── 商品圖片儲存 ────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists product_images_write on storage.objects;
create policy product_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and owner = auth.uid());
