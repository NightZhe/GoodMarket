-- 買家註冊登入 M1（.work/buyer-auth/spec.md v0.2 第 9、13 節；decisions.md D1–D19）
--
-- M1 只新增、不收回任何權限：舊前端（遊客購物車、憑證查單／取消／完成／評價、匿名下單）照常運作。
--   · orders.buyer_id、orders.buyer_deleted_at（都不 grant 給 authenticated，賣家讀不到也改不了；後者區分「訪客訂單」與「帳號已刪除的訂單」）
--   · cart_items（D15）：購物車綁帳號，RLS 只能動自己的列
--   · 帳號版 RPC：place_account_order、get_account_orders、cancel_account_order、complete_account_order、
--     get_account_review_status、request_account_review_upload、submit_account_reviews、add_to_cart
--   · place_order（舊簽名與回傳不變）：登入時寫 buyer_id、擋自購（D12）；匿名照舊可下（M2 才收回）
--   · 評價的 _rv_load_order／request_review_upload／submit_reviews／get_my_review_status 內部重構成
--     「驗身分」與「做事」兩層，token 版與帳號版共用同一份規則；對外行為、錯誤碼、回傳格式不變
--
-- M2（收回權限）與 M3（刪 token 路徑）不在這個檔案。orders 的欄位權限完全沒有動。
--
-- 錯誤格式沿用既有慣例：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）。
-- 套用方式見 CLAUDE.md：本機 supabase db reset --local；正式站 db query --linked -f（要等使用者確認）。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. orders.buyer_id
-- ═══════════════════════════════════════════════════════════════════════
-- on delete set null：人工刪帳號時訂單留給賣家對帳（不能 cascade）。
-- 不加 NOT NULL：刪帳號後會變 null；「新訂單一定有 buyer_id」由 place_account_order／M2 的 place_order 保證。
-- 注意：orders 的欄位權限是逐欄 grant（見 20261016120000 最後一節），新欄位 authenticated 預設讀不到、改不到。
-- 這裡「刻意不 grant」：買家一律經 SECURITY DEFINER 的 RPC 存取，賣家不需要也不該看到買家帳號 id。
alter table public.orders
  add column if not exists buyer_id uuid references auth.users(id) on delete set null;
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);

-- buyer_deleted_at：這張訂單的買家帳號已被刪除的時間。
-- 為什麼需要：人工刪帳號後 buyer_id 因 on delete set null 變成 null，和「上線前的訪客訂單」（本來就沒有 buyer_id）
-- 在資料上長得一模一樣。兩者的處理完全相反：訪客訂單在上線時整批刪除（D3）；帳號已刪的訂單是要保留給賣家對帳的交易紀錄。
-- 定義：  訪客訂單          ＝ buyer_id is null and buyer_deleted_at is null
--         帳號已刪除的訂單  ＝ buyer_id is null and buyer_deleted_at is not null
-- M3 的防呆、tools/01-preview、02-delete、03-verify 都只認「訪客訂單」。
-- 同樣不 grant 給 authenticated（賣家讀不到也改不了）。
alter table public.orders add column if not exists buyer_deleted_at timestamptz;

-- 由 trigger 自動蓋章，不靠任何刪帳號工具記得去做：on delete set null 是以 UPDATE 執行的，會觸發 BEFORE UPDATE trigger。
-- 所以不論用人工刪帳號工具、Supabase 後台刪使用者、auth.admin.deleteUser，只要 buyer_id 從「有值」變成 null 就會蓋章。
-- 只在 buyer_id 從有值變 null 且還沒章的時候蓋；訪客訂單（本來就是 null）不會被蓋。
create or replace function public._orders_mark_buyer_deleted()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.buyer_id is not null and new.buyer_id is null and new.buyer_deleted_at is null then
    new.buyer_deleted_at := now();
  end if;
  return new;
end $$;
revoke all on function public._orders_mark_buyer_deleted() from public, anon, authenticated;

drop trigger if exists orders_mark_buyer_deleted on public.orders;
create trigger orders_mark_buyer_deleted before update of buyer_id on public.orders
  for each row execute function public._orders_mark_buyer_deleted();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 購物車（D15）
-- ═══════════════════════════════════════════════════════════════════════
-- 不存價格與商品快照（顯示時讀 products）。商品被刪除時，購物車的列一併 cascade 刪掉。
-- 商品下架（status = 'hidden'）時列還在，由前端顯示「已失效」；結帳時 place_order 會擋。
-- variant_id 是 products.variants（jsonb）裡的規格 id，沒有外鍵可掛；新增時由 add_to_cart 驗證。
create table if not exists public.cart_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id text not null check (variant_id <> ''),
  qty        integer not null check (qty between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id, variant_id)
);
create index if not exists cart_items_product_idx on public.cart_items (product_id);

alter table public.cart_items enable row level security;

-- 直接用 PostgREST：讀、改數量、刪除。「加入購物車」不開放直接 insert（要驗商品、規格、自購、庫存），走 add_to_cart。
drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items for select to authenticated
  using (user_id = auth.uid());
drop policy if exists cart_items_update_own on public.cart_items;
create policy cart_items_update_own on public.cart_items for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items for delete to authenticated
  using (user_id = auth.uid());

-- 預設權限會把新表全開給 anon／authenticated：全部收回，再只給需要的。
-- 被擋時會得到 permission denied（42501），不是靜默回空。anon 完全沒有權限。
revoke all on public.cart_items from public, anon, authenticated;
grant select, delete on public.cart_items to authenticated;
grant update (qty) on public.cart_items to authenticated;

create or replace function public._cart_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public._cart_touch() from public, anon, authenticated;

drop trigger if exists cart_items_touch on public.cart_items;
create trigger cart_items_touch before update on public.cart_items
  for each row execute function public._cart_touch();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 共用小工具與回傳型別
-- ═══════════════════════════════════════════════════════════════════════

-- 登入的帳號 id；沒登入（含 session 過期，此時 PostgREST 以 anon 身分執行）→ NOT_AUTHENTICATED。
-- 帳號版 RPC 都開給 anon，就是為了讓「session 過期」得到中文的 NOT_AUTHENTICATED，而不是英文的 permission denied。
create or replace function public._acct_uid(p_message text default '請先登入')
returns uuid language plpgsql stable set search_path = public as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform public._rv_raise('NOT_AUTHENTICATED', p_message);
  end if;
  return v;
end $$;

-- 買家看自己訂單的欄位（跟 get_my_orders 同 12 欄；沒有 access_token、收件資料、buyer_id）
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'buyer_order') then
    create type public.buyer_order as (
      id uuid, order_no text, shop_id uuid, lines jsonb, shipping_fee integer, total integer,
      status text, payment text, carrier text, tracking_no text, events jsonb, created_at timestamptz
    );
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 下單：共用核心 ＋ 舊簽名 place_order ＋ 帳號版 place_account_order
-- ═══════════════════════════════════════════════════════════════════════
-- 核心＝原本 place_order 的邏輯（扣庫存、加銷量、依店分單、運費），加上：
--   · p_uid 不是 null 時：訂單寫入 buyer_id；商品屬於這個帳號自己的店 → OWN_SHOP（D12）
--   · p_from_cart 為 true（而且有登入）時：同一個交易裡把已下單的品項從購物車刪掉（R-8）
--   · 錯誤訊息文字跟以前一樣，只多了 hint 代碼；壞輸入（非陣列、productId 不是 uuid、qty 不是整數）改回中文錯誤，
--     不再是 Postgres 的英文 cast 錯誤
-- 只給下面兩個包裝函式呼叫，不開放給前端。
create or replace function public._place_order_core(
  p_items jsonb, p_buyer jsonb, p_payment text, p_uid uuid, p_from_cart boolean
) returns setof public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_variant  jsonb;
  v_idx      integer;
  v_qty      integer;
  v_groups   jsonb := '{}'::jsonb;
  v_group    jsonb;
  v_key      text;
  v_subtotal integer;
  v_shipping integer;
  v_order    public.orders%rowtype;
begin
  if p_payment is null or p_payment not in ('cod', 'card', 'transfer') then
    perform public._rv_raise('PAYMENT_INVALID', '付款方式不正確');
  end if;
  if coalesce(p_buyer->>'name', '') = '' or coalesce(p_buyer->>'phone', '') = ''
     or coalesce(p_buyer->>'address', '') = '' then
    perform public._rv_raise('BUYER_INCOMPLETE', '收件資訊不完整');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public._rv_raise('EMPTY_ITEMS', '沒有要結帳的商品');
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'productId') is distinct from 'string'
       or (v_item->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item->'variantId') is distinct from 'string' then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    -- qty：沒給或 null＝1；給了就必須是整數（JSON 數字或數字字串），至少 1
    if coalesce(jsonb_typeof(v_item->'qty'), 'null') <> 'null' and (v_item->>'qty') !~ '^-?[0-9]{1,9}$' then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));

    -- for update：鎖住這一列，同時間另一筆訂單要等這筆做完才能扣同一份庫存
    select * into v_product from public.products p
      where p.id = (v_item->>'productId')::uuid and p.status = 'active' for update;
    if not found then
      perform public._rv_raise('PRODUCT_UNAVAILABLE', '商品不存在或已下架');
    end if;

    -- D12：店主不能買自己店的商品
    if p_uid is not null and exists (
         select 1 from public.shops s where s.id = v_product.shop_id and s.owner_id = p_uid) then
      perform public._rv_raise('OWN_SHOP', '不能購買自己商店的商品');
    end if;

    select ord - 1, value into v_idx, v_variant
      from jsonb_array_elements(v_product.variants) with ordinality as t(value, ord)
      where value->>'id' = v_item->>'variantId';
    if v_idx is null then
      perform public._rv_raise('VARIANT_NOT_FOUND', '規格不存在');
    end if;
    if (v_variant->>'stock')::integer < v_qty then
      raise exception '「%」的庫存不足，只剩 % 件', v_product.title, (v_variant->>'stock')::integer
        using hint = 'OUT_OF_STOCK';
    end if;

    update public.products p set
      variants = jsonb_set(p.variants, array[v_idx::text, 'stock'],
                           to_jsonb((v_variant->>'stock')::integer - v_qty)),
      sold = p.sold + v_qty
    where p.id = v_product.id;

    v_key := v_product.shop_id::text;
    v_group := coalesce(v_groups -> v_key,
                        jsonb_build_object('lines', '[]'::jsonb, 'subtotal', 0, 'all_free', true));
    v_groups := jsonb_set(v_groups, array[v_key], jsonb_build_object(
      'lines', (v_group -> 'lines') || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'variantId', v_variant->>'id',
        'title', v_product.title, 'variantName', v_variant->>'name',
        'image', coalesce(v_product.images->>0, ''),
        'price', (v_variant->>'price')::integer, 'qty', v_qty
      )),
      'subtotal', (v_group->>'subtotal')::integer + (v_variant->>'price')::integer * v_qty,
      'all_free', (v_group->>'all_free')::boolean and v_product.free_shipping
    ));
  end loop;

  -- 每家店開一張單：同店滿 499 免運，或該店這批商品都標免運
  for v_key, v_group in select key, value from jsonb_each(v_groups) loop
    v_subtotal := (v_group->>'subtotal')::integer;
    v_shipping := case when v_subtotal >= 499 or (v_group->>'all_free')::boolean then 0 else 60 end;

    insert into public.orders (shop_id, lines, shipping_fee, total, buyer_name, buyer_phone, buyer_address, payment, buyer_id)
    values (v_key::uuid, v_group -> 'lines', v_shipping, v_subtotal + v_shipping,
            p_buyer->>'name', p_buyer->>'phone', p_buyer->>'address', p_payment, p_uid)
    returning * into v_order;

    return next v_order;
  end loop;

  -- R-8：從購物車結帳 → 已下單的品項從帳號購物車移除（所有裝置）；沒勾的保留。直接購買不動購物車。
  if p_from_cart and p_uid is not null then
    delete from public.cart_items c
     using jsonb_array_elements(p_items) i
     where c.user_id = p_uid
       and c.product_id = (i.value->>'productId')::uuid
       and c.variant_id = i.value->>'variantId';
  end if;
  return;
end $$;
revoke all on function public._place_order_core(jsonb, jsonb, text, uuid, boolean) from public, anon, authenticated;

-- 舊簽名與回傳型別完全不變（舊前端照常下單，拿到 access_token）。
-- 登入時（例如已登入的賣家去買別家的東西）一併寫 buyer_id、擋自購；匿名照舊可下，M2 才拒絕。
create or replace function public.place_order(p_items jsonb, p_buyer jsonb, p_payment text)
returns table(id uuid, access_token text, shop_id uuid, lines jsonb, shipping_fee integer, total integer, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select o.id, o.access_token, o.shop_id, o.lines, o.shipping_fee, o.total, o.created_at
      from public._place_order_core(p_items, p_buyer, p_payment, auth.uid(), false) o;
end $$;

-- 帳號版下單：一定要登入，訂單綁帳號；回傳沒有 access_token（M3 之後 place_order 也長這樣）。
-- p_from_cart＝true 時，成功後同一個交易內把這批品項從購物車刪掉。回傳 buyer_order 陣列（一家店一張）。
create or replace function public.place_account_order(
  p_items jsonb, p_buyer jsonb, p_payment text, p_from_cart boolean default false
) returns setof public.buyer_order
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入再下單');
begin
  return query
    select o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment,
           o.carrier, o.tracking_no, o.events, o.created_at
      from public._place_order_core(p_items, p_buyer, p_payment, v_uid, coalesce(p_from_cart, false)) o;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 加入購物車（原子累加）
-- ═══════════════════════════════════════════════════════════════════════
-- 同一品項已在購物車 → 數量累加（一次呼叫 = +p_qty）。重複呼叫會重複累加，"待辦動作用過即刪"由前端負責（AC-15）。
-- 檢查：登入、商品上架中、規格存在、規格有庫存（>= 1）、不是自己店的商品（D12）、累計數量 <= 999。
-- 累計數量可以超過庫存（跟現況一樣，結帳時 place_order 才檢查庫存）。
-- 回傳這一列的最新狀態 { product_id, variant_id, qty }。
create or replace function public.add_to_cart(p_product_id uuid, p_variant_id text, p_qty integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := public._acct_uid();
  v_product public.products%rowtype;
  v_variant jsonb;
  v_old     integer;
  v_new     integer;
begin
  if p_product_id is null or coalesce(p_variant_id, '') = '' then
    perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
  end if;
  if p_qty is null or p_qty not between 1 and 999 then
    perform public._rv_raise('QTY_INVALID', '數量需為 1 到 999');
  end if;

  select * into v_product from public.products p where p.id = p_product_id and p.status = 'active';
  if not found then
    perform public._rv_raise('PRODUCT_UNAVAILABLE', '商品不存在或已下架');
  end if;
  if exists (select 1 from public.shops s where s.id = v_product.shop_id and s.owner_id = v_uid) then
    perform public._rv_raise('OWN_SHOP', '不能購買自己商店的商品');
  end if;

  select t.value into v_variant
    from jsonb_array_elements(v_product.variants) as t(value) where t.value->>'id' = p_variant_id;
  if v_variant is null then
    perform public._rv_raise('VARIANT_NOT_FOUND', '規格不存在');
  end if;
  if coalesce((v_variant->>'stock')::integer, 0) < 1 then
    perform public._rv_raise('OUT_OF_STOCK', '這個規格目前沒有庫存');
  end if;

  select c.qty into v_old from public.cart_items c
    where c.user_id = v_uid and c.product_id = p_product_id and c.variant_id = p_variant_id;
  if coalesce(v_old, 0) + p_qty > 999 then
    perform public._rv_raise('QTY_INVALID', '數量需為 1 到 999');
  end if;

  insert into public.cart_items (user_id, product_id, variant_id, qty)
  values (v_uid, p_product_id, p_variant_id, p_qty)
  on conflict (user_id, product_id, variant_id)
    do update set qty = public.cart_items.qty + excluded.qty
  returning qty into v_new;

  return jsonb_build_object('product_id', p_product_id, 'variant_id', p_variant_id, 'qty', v_new);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 帳號版查單、取消、完成
-- ═══════════════════════════════════════════════════════════════════════
-- 別人的訂單、不存在的訂單一律 ORDER_NOT_FOUND（不透露存在與否）。
create or replace function public.get_account_orders()
returns setof public.buyer_order
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid();
begin
  return query
    select o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment,
           o.carrier, o.tracking_no, o.events, o.created_at
      from public.orders o
     where o.buyer_id = v_uid
     order by o.created_at desc, o.id;
end $$;

-- 狀態轉移：鎖住該列 → 確認目前狀態 → 改。不像舊的 cancel_my_order／complete_my_order 靜默成功：
-- 狀態不符一律報錯，訊息格式與 guard_order_status 相同，另加 hint = ORDER_STATE_CHANGED。
-- 實際的轉移規則仍由 orders_guard_status trigger 把關（這裡只允許 to_ship→cancelled、shipping→completed）。
create or replace function public._account_order_transition(p_id uuid, p_from text, p_to text)
returns public.buyer_order
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public._acct_uid();
  v_label constant jsonb := '{"to_ship":"待出貨","shipping":"運送中","completed":"已完成","cancelled":"已取消"}';
  v_cur   text;
  v_out   public.buyer_order;
begin
  select o.status into v_cur from public.orders o
   where o.id = p_id and o.buyer_id = v_uid for update;
  if not found then
    perform public._rv_raise('ORDER_NOT_FOUND', '找不到這筆訂單');
  end if;
  if v_cur <> p_from then
    raise exception '訂單狀態已變更（目前：%），無法改為%，請重新整理',
      coalesce(v_label->>v_cur, v_cur), coalesce(v_label->>p_to, p_to)
      using hint = 'ORDER_STATE_CHANGED';
  end if;

  update public.orders o set status = p_to where o.id = p_id
  returning o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment,
            o.carrier, o.tracking_no, o.events, o.created_at
  into v_out;
  return v_out;
end $$;
revoke all on function public._account_order_transition(uuid, text, text) from public, anon, authenticated;

-- 取消：只有待出貨（to_ship）。回傳更新後的訂單（單一物件）。
create or replace function public.cancel_account_order(p_id uuid)
returns public.buyer_order language sql security definer set search_path = public as $$
  select public._account_order_transition(p_id, 'to_ship', 'cancelled');
$$;

-- 完成：只有運送中（shipping）。回傳更新後的訂單（單一物件）。
create or replace function public.complete_account_order(p_id uuid)
returns public.buyer_order language sql security definer set search_path = public as $$
  select public._account_order_transition(p_id, 'shipping', 'completed');
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. 評價：重構成「驗身分」＋「做事」兩層（對外行為不變），再加帳號版
-- ═══════════════════════════════════════════════════════════════════════

-- R-1 的 2～3 點：已完成、沒過期。身分（憑證或帳號）由呼叫端先驗。
create or replace function public._rv_check_reviewable(p_order public.orders)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_order.status <> 'completed' then
    perform public._rv_raise('ORDER_NOT_COMPLETED', '訂單完成後才能評價');
  end if;
  if public._rv_expired(public._rv_completed_at(p_order.events), now()) then
    perform public._rv_raise('REVIEW_EXPIRED', '評價期限已過');
  end if;
end $$;

-- token 版（M3 會 drop）：行為與 20261016120000 的版本完全相同
create or replace function public._rv_load_order(p_order_id uuid, p_token text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v public.orders;
begin
  select * into v from public.orders o
    where o.id = p_order_id and o.access_token = p_token for update;
  if not found then
    perform public._rv_raise('ORDER_NOT_FOUND', '找不到這筆訂單');
  end if;
  perform public._rv_check_reviewable(v);
  return v;
end $$;

-- 帳號版：沒登入 → NOT_AUTHENTICATED；不是自己的訂單（含不存在）→ ORDER_NOT_FOUND。同樣 for update 鎖列。
create or replace function public._rv_load_account_order(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid();
  v     public.orders;
begin
  select * into v from public.orders o
    where o.id = p_order_id and o.buyer_id = v_uid for update;
  if not found then
    perform public._rv_raise('ORDER_NOT_FOUND', '找不到這筆訂單');
  end if;
  perform public._rv_check_reviewable(v);
  return v;
end $$;

-- 一張已完成訂單的評價狀態（get_my_review_status／get_account_review_status 共用，輸出格式與原本相同）
create or replace function public._rv_order_status(p_o public.orders, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'order_id', p_o.id, 'order_no', p_o.order_no,
      'completed_at', c.at,
      'deadline_date', to_char(public._rv_deadline_date(c.at), 'YYYY-MM-DD'),
      'deadline_at', public._rv_deadline_at(c.at),
      'expired', public._rv_expired(c.at, p_now),
      'items', it.items)
  from (select public._rv_completed_at(p_o.events) as at) c
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', g.pid,
        'title', g.snap->>'title', 'image', g.snap->>'image', 'variant_names', g.snap->'variant_names',
        'reviewed', r.id is not null,
        'review', case when r.id is null then null else jsonb_build_object(
            'id', r.id, 'rating', r.rating, 'content', r.content, 'nickname', r.reviewer_nickname,
            'created_at', r.created_at,
            'photos', coalesce((select jsonb_agg(ph.path order by ph.position)
                                  from public.review_photos ph where ph.review_id = r.id and ph.removed_at is null), '[]'::jsonb),
            'seller_reply', r.seller_reply, 'seller_replied_at', r.seller_replied_at,
            'hidden', r.hidden_at is not null) end
      ) order by g.first_ord), '[]'::jsonb) as items
    from (
      select x.pid, public._rv_snapshot(p_o.lines, x.pid) as snap, x.first_ord
        from (select (t.value->>'productId')::uuid as pid, min(t.ord) as first_ord
                from jsonb_array_elements(p_o.lines) with ordinality as t(value, ord)
               where t.value->>'productId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               group by 1) x
    ) g
    left join public.product_reviews r on r.order_id = p_o.id and r.product_id = g.pid
  ) it;
$$;

-- token 版（M3 會 drop）：輸出與原本相同
create or replace function public.get_my_review_status(p_keys jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public._rv_order_status(o, v_now) order by o.created_at desc, o.id)
    from (select distinct k.value as k from jsonb_array_elements(p_keys) as k(value)) keys
    join public.orders o
      on o.id = case when keys.k->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then (keys.k->>'id')::uuid end
     and o.access_token = keys.k->>'token'
     and o.status = 'completed'
  ), '[]'::jsonb);
end $$;

-- 帳號版：這個帳號所有「已完成」的訂單（新的在前），格式同 get_my_review_status
create or replace function public.get_account_review_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid();
  v_now timestamptz := now();
begin
  return coalesce((
    select jsonb_agg(public._rv_order_status(o, v_now) order by o.created_at desc, o.id)
      from public.orders o
     where o.buyer_id = v_uid and o.status = 'completed'
  ), '[]'::jsonb);
end $$;

-- 申請照片上傳位置（R-18、R-19）。p_order 已經驗過身分、鎖過列。
create or replace function public._rv_request_upload(p_order public.orders, p_product_id uuid, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expires timestamptz := now() + interval '30 minutes';
  v_out     jsonb;
begin
  if public._rv_snapshot(p_order.lines, p_product_id) is null then
    perform public._rv_raise('PRODUCT_NOT_IN_ORDER', '資料有誤，請重新整理');
  end if;
  if exists (select 1 from public.product_reviews r where r.order_id = p_order.id and r.product_id = p_product_id) then
    perform public._rv_raise('ALREADY_REVIEWED', '這件商品已經評價過了');
  end if;
  if p_count is null or p_count not between 1 and 5 then
    perform public._rv_raise('UPLOAD_COUNT_INVALID', '每則評價最多 5 張照片');
  end if;
  if (select count(*) from public.review_upload_slots s
       where s.order_id = p_order.id and s.product_id = p_product_id) + p_count > 15 then
    perform public._rv_raise('UPLOAD_LIMIT_EXCEEDED', '照片上傳次數已達上限');
  end if;

  with ins as (
    insert into public.review_upload_slots (order_id, product_id, path, expires_at)
    select p_order.id, p_product_id, gen_random_uuid()::text || '.jpg', v_expires
      from generate_series(1, p_count)
    returning path, expires_at
  )
  select jsonb_agg(jsonb_build_object('path', ins.path, 'expires_at', ins.expires_at)) into v_out from ins;
  return v_out;
end $$;

-- 送出評價（R-1、R-4、R-5、R-7、R-17、R-18）。p_order 已經驗過身分、鎖過列、確認過已完成且沒過期。
-- 全有全無：任何一件不合格就 raise，整個交易回滾。規則與 20261016120000 的 submit_reviews 完全相同。
create or replace function public._rv_submit(p_order public.orders, p_nickname text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nick    text;
  v_item    jsonb;
  v_pid     uuid;
  v_seen    uuid[] := array[]::uuid[];
  v_snap    jsonb;
  v_rating  jsonb;
  v_content text;
  v_photos  jsonb;
  v_ph      jsonb;
  v_ord     integer;
  v_slot    public.review_upload_slots;
  v_rid     uuid;
  v_out     jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public._rv_raise('EMPTY_SUBMISSION', '請至少評價一件商品');
  end if;
  v_nick := public._rv_nickname(p_nickname);

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'productId') is distinct from 'string'
       or (v_item->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    v_pid := (v_item->>'productId')::uuid;
    if v_pid = any (v_seen) then
      perform public._rv_raise('DUPLICATE_ITEM', '資料有誤，請重新整理');
    end if;
    v_seen := v_seen || v_pid;

    v_snap := public._rv_snapshot(p_order.lines, v_pid);
    if v_snap is null then
      perform public._rv_raise('PRODUCT_NOT_IN_ORDER', '資料有誤，請重新整理');
    end if;
    if exists (select 1 from public.product_reviews r where r.order_id = p_order.id and r.product_id = v_pid) then
      perform public._rv_raise('ALREADY_REVIEWED', '這件商品已經評價過了');
    end if;

    v_rating := v_item->'rating';
    if v_rating is null or jsonb_typeof(v_rating) <> 'number'
       or (v_rating #>> '{}')::numeric <> trunc((v_rating #>> '{}')::numeric)
       or (v_rating #>> '{}')::numeric not between 1 and 5 then
      perform public._rv_raise('RATING_INVALID', '請選擇 1 到 5 顆星');
    end if;

    case coalesce(jsonb_typeof(v_item->'content'), 'null')
      when 'null'   then v_content := '';
      when 'string' then v_content := public._rv_trim(v_item->>'content');
      else perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end case;
    if char_length(v_content) > 500 then
      perform public._rv_raise('CONTENT_TOO_LONG', '評價內容最多 500 字');
    end if;

    case coalesce(jsonb_typeof(v_item->'photos'), 'null')
      when 'null'  then v_photos := '[]'::jsonb;
      when 'array' then v_photos := v_item->'photos';
      else perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end case;
    if jsonb_array_length(v_photos) > 5 then
      perform public._rv_raise('PHOTO_TOO_MANY', '每則評價最多 5 張照片');
    end if;

    insert into public.product_reviews
      (order_id, shop_id, product_id, product_title, product_image, variant_names, rating, content, reviewer_nickname)
    values
      (p_order.id, p_order.shop_id, v_pid, v_snap->>'title', v_snap->>'image',
       array(select jsonb_array_elements_text(v_snap->'variant_names')),
       (v_rating #>> '{}')::numeric::smallint, v_content, v_nick)
    returning id into v_rid;

    v_ord := 0;
    for v_ph in select value from jsonb_array_elements(v_photos) loop
      if jsonb_typeof(v_ph) <> 'string' then
        perform public._rv_raise('PHOTO_INVALID', '照片上傳不完整，請重新上傳');
      end if;
      -- 路徑必須是「這張訂單、這件商品」申請的、還沒用過的位置（同一個路徑出現兩次，第二次會是已使用）
      select * into v_slot from public.review_upload_slots s
        where s.path = (v_ph #>> '{}') and s.order_id = p_order.id and s.product_id = v_pid
        for update;
      if not found or v_slot.used_at is not null then
        perform public._rv_raise('PHOTO_INVALID', '照片上傳不完整，請重新上傳');
      end if;
      if v_slot.expires_at <= now() then
        perform public._rv_raise('UPLOAD_EXPIRED', '照片上傳逾時，請重新上傳');
      end if;
      if not exists (select 1 from storage.objects so where so.bucket_id = 'review-images' and so.name = v_slot.path) then
        perform public._rv_raise('PHOTO_INVALID', '照片上傳不完整，請重新上傳');
      end if;
      update public.review_upload_slots set used_at = now() where id = v_slot.id;
      insert into public.review_photos (review_id, path, position) values (v_rid, v_slot.path, v_ord);
      v_ord := v_ord + 1;
    end loop;

    v_out := v_out || jsonb_build_object('id', v_rid, 'product_id', v_pid);
  end loop;

  return v_out;
end $$;

-- token 版（M3 會 drop）：簽名、回傳、錯誤碼不變
create or replace function public.request_review_upload(p_order_id uuid, p_token text, p_product_id uuid, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._rv_request_upload(public._rv_load_order(p_order_id, p_token), p_product_id, p_count);
end $$;

create or replace function public.submit_reviews(p_order_id uuid, p_token text, p_nickname text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._rv_submit(public._rv_load_order(p_order_id, p_token), p_nickname, p_items);
end $$;

-- 帳號版：規則、錯誤碼、回傳格式與 token 版相同，只把「憑證對得上」換成「訂單屬於目前登入的帳號」
create or replace function public.request_account_review_upload(p_order_id uuid, p_product_id uuid, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._rv_request_upload(public._rv_load_account_order(p_order_id), p_product_id, p_count);
end $$;

create or replace function public.submit_account_reviews(p_order_id uuid, p_nickname text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._rv_submit(public._rv_load_account_order(p_order_id), p_nickname, p_items);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. 函式權限
-- ═══════════════════════════════════════════════════════════════════════
-- 預設權限會把新函式開給 anon／authenticated：內部函式全部收回；對外 RPC 只收回 public、保留 anon／authenticated，
-- 讓沒登入或 session 過期的呼叫得到中文的 NOT_AUTHENTICATED（而不是英文的 permission denied）。
-- create or replace 既有函式不會改動它們原本的 grant（place_order、_rv_load_order、get_my_review_status…維持原樣）。

revoke all on function public._rv_check_reviewable(public.orders)                          from public, anon, authenticated;
revoke all on function public._rv_load_account_order(uuid)                                 from public, anon, authenticated;
revoke all on function public._rv_order_status(public.orders, timestamptz)                 from public, anon, authenticated;
revoke all on function public._rv_request_upload(public.orders, uuid, integer)             from public, anon, authenticated;
revoke all on function public._rv_submit(public.orders, text, jsonb)                       from public, anon, authenticated;
revoke all on function public._acct_uid(text)                                              from public, anon, authenticated;

revoke all on function public.place_account_order(jsonb, jsonb, text, boolean)             from public;
revoke all on function public.add_to_cart(uuid, text, integer)                             from public;
revoke all on function public.get_account_orders()                                         from public;
revoke all on function public.cancel_account_order(uuid)                                   from public;
revoke all on function public.complete_account_order(uuid)                                 from public;
revoke all on function public.get_account_review_status()                                  from public;
revoke all on function public.request_account_review_upload(uuid, uuid, integer)           from public;
revoke all on function public.submit_account_reviews(uuid, text, jsonb)                    from public;
grant execute on function public.place_account_order(jsonb, jsonb, text, boolean)          to anon, authenticated;
grant execute on function public.add_to_cart(uuid, text, integer)                          to anon, authenticated;
grant execute on function public.get_account_orders()                                      to anon, authenticated;
grant execute on function public.cancel_account_order(uuid)                                to anon, authenticated;
grant execute on function public.complete_account_order(uuid)                              to anon, authenticated;
grant execute on function public.get_account_review_status()                               to anon, authenticated;
grant execute on function public.request_account_review_upload(uuid, uuid, integer)       to anon, authenticated;
grant execute on function public.submit_account_reviews(uuid, text, jsonb)                 to anon, authenticated;
