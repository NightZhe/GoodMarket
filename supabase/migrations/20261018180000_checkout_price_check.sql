-- 結帳比價：下單時伺服器比對買家看到的單價、每店運費，並一併檢查庫存
--   （.work/checkout-price-check/spec.md v0.2 第 4.2、5 節；decisions.md D-7b～D-7j；介面定稿見同資料夾 interface.md）
--
-- 只做相容的新增（spec 7.1）：舊函式 place_account_order／_place_order_core 一個字都不改，舊前端照常下單。
--   1. 表 checkout_rejection_log：下單被擋時，每個問題一筆（原因 price／stock／shipping）。不記買家身分（D-7f）。
--      anon、authenticated 沒有任何權限（含 identity 序號）；只給維運用 db query 唯讀查詢（spec 9）。
--   2. 函式 place_checked_order(p_items, p_buyer, p_payment, p_from_cart, p_seen_shipping) → jsonb
--        · p_items 每項 { productId, variantId, qty, price }：price＝結帳頁顯示的單價（必填，0 以上的 JSON 整數）
--        · p_seen_shipping { "<shopId>": 運費, … }：結帳頁每家店顯示的運費。預設 null，null／缺店／多店／格式錯 → ITEM_INVALID。
--          做成「有預設值」而不是必填：前端漏帶時得到我們自己的 ITEM_INVALID，不會被 PostgREST 誤報成「找不到函式」
--          （PGRST202 留給「資料庫還沒套這個檔」那一種情況，前端才分得清，spec 7.2）。
--        · 檢查順序（spec 4.2）：登入 → 付款／收件／空品項 → 每項格式（含 price）→ 運費參數格式
--          → 逐件照送出順序鎖列（for update，與 quick_edit_product、place_account_order 鎖同一列）：
--            下架／自購／規格不存在照現行 raise（第一個就停、整個交易回滾、不留紀錄）；
--            通過的在同一次掃描裡收集「價格變動」「庫存不足（同規格合計數量）」，這一步不寫入
--          → 運費參數必須剛好涵蓋這次送出的每一家店 → 逐店用「目前單價 × 送出數量」與目前免運設定算運費並比對
--          → 有任何問題：寫失敗紀錄、回 { outcome:'rejected', changes:[…] }（正常回傳，交易提交；不建單、不扣庫存、不動購物車）
--          → 沒有問題：與 _place_order_core 完全相同的建單（扣庫存、加銷量、依店分單、運費、從購物車移除），lines 每項多 seenPrice
--        · 不會 raise OUT_OF_STOCK（改由 changes 的 stock 表達）
--      開給 anon、authenticated（慣例同其他帳號版 RPC：沒登入得到中文 NOT_AUTHENTICATED，而不是英文 permission denied）。
--      函式名稱與舊函式不同，沒有多載：PostgREST 不會出現 PGRST203。
--   3. 自我檢查：權限不如預期就整個回滾。
--
-- 運費規則與 _place_order_core 第 227～230 行、前端 shippingFor 相同：同店小計 ≥ 499，或該店這批商品全部免運 → 0，否則 60。
-- 可重複執行。整個檔案包在一個交易裡，任何一步失敗就整個回滾。
begin;

-- ──────────────────────────── 失敗紀錄表 ────────────────────────────
-- 一個問題一筆；同一次送出（同一個交易）的幾筆 tx_id 相同。
--   price    ：product_id、variant_id、seen_value＝看到的單價、current_value＝目前單價
--   stock    ：product_id、variant_id、qty＝這次要買的合計數量、stock＝目前庫存（0＝已售完）
--   shipping ：seen_value＝看到的運費、current_value＝目前運費（product_id、variant_id 為 null）
-- 商品或商店被刪掉時紀錄保留（外鍵 set null），次數統計不受影響。

create table if not exists public.checkout_rejection_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default clock_timestamp(),
  tx_id         bigint not null default txid_current(),
  reason        text not null check (reason in ('price', 'stock', 'shipping')),
  shop_id       uuid references public.shops(id) on delete set null,
  from_cart     boolean not null,
  product_id    uuid references public.products(id) on delete set null,
  variant_id    text,
  seen_value    integer,
  current_value integer,
  qty           bigint,     -- 合計數量可能超過 integer（API 直接打極大數量時），所以用 bigint
  stock         integer,
  constraint checkout_rejection_log_shape check (case reason
    when 'price'    then variant_id is not null and seen_value is not null and current_value is not null and qty is null and stock is null
    when 'stock'    then variant_id is not null and qty is not null and stock is not null and seen_value is null and current_value is null
    when 'shipping' then product_id is null and variant_id is null and seen_value is not null and current_value is not null and qty is null and stock is null
  end)
);
create index if not exists checkout_rejection_log_created_idx on public.checkout_rejection_log (created_at);

-- RLS 開著、沒有任何 policy；再把預設權限全部收回（新表、新序號預設會開給 anon／authenticated）
alter table public.checkout_rejection_log enable row level security;
revoke all on public.checkout_rejection_log from public, anon, authenticated;
revoke all on sequence public.checkout_rejection_log_id_seq from public, anon, authenticated;

-- ──────────────────────────── place_checked_order ────────────────────────────
-- 回傳 jsonb，outcome 兩種：
--   ok       { outcome, orders: [buyer_order 的 12 欄（同 place_account_order 的回傳）] }
--   rejected { outcome, changes: [ {kind:'price', productId, variantId, shopId, title, variantName, seenPrice, currentPrice}
--                                | {kind:'stock', productId, variantId, shopId, title, variantName, qty, stock}
--                                | {kind:'shipping', shopId, shopName, seenFee, currentFee} ] }
--     順序：商品在前（依 p_items 順序；同一件 price 在 stock 前；同一規格出現多次時 stock 只在第一次出現處列一筆、
--           看到的價格相同的 price 也只列一筆），運費在後（依商店在 p_items 第一次出現的順序）。
-- 其餘用 raise exception，hint＝代碼、message＝中文，代碼與訊息同 place_account_order：
--   NOT_AUTHENTICATED、PAYMENT_INVALID、BUYER_INCOMPLETE、EMPTY_ITEMS、ITEM_INVALID、PRODUCT_UNAVAILABLE、OWN_SHOP、VARIANT_NOT_FOUND

create or replace function public.place_checked_order(
  p_items jsonb, p_buyer jsonb, p_payment text, p_from_cart boolean default false, p_seen_shipping jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := public._acct_uid('請先登入再下單');
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_variant   jsonb;
  v_idx       integer;
  v_qty       integer;
  v_vkey      text;
  v_totals    jsonb := '{}'::jsonb;
  v_price     integer;
  v_seen      integer;
  v_stock     integer;
  v_seen_px   text[] := '{}';             -- 已列過的「規格|看到的價格」（同一規格同一個看到的價格只列一筆 price）
  v_seen_qty  text[] := '{}';             -- 已列過庫存檢查的規格（同一規格只檢查、只列一筆 stock）
  v_changes   jsonb := '[]'::jsonb;
  v_seen_ship jsonb := '{}'::jsonb;
  v_ship      jsonb := '{}'::jsonb;
  v_shop_ord  text[] := '{}';
  v_fee       integer;
  v_k         text;
  v_v         jsonb;
  v_groups    jsonb := '{}'::jsonb;
  v_group     jsonb;
  v_key       text;
  v_subtotal  integer;
  v_shipping  integer;
  v_order     public.orders%rowtype;
  v_orders    jsonb := '[]'::jsonb;
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

  -- 每項格式（還沒碰資料）。productId／variantId／qty 的規則同 _place_order_core；price 只收 0 以上的 JSON 整數寫法
  -- 順便算「同一規格在這次送出的合計數量」，key 用 uuid 正規化後的字串（大小寫不同的同一 id 也合計）
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'productId') is distinct from 'string'
       or (v_item->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item->'variantId') is distinct from 'string'
       or (coalesce(jsonb_typeof(v_item->'qty'), 'null') <> 'null' and (v_item->>'qty') !~ '^-?[0-9]{1,9}$')
       or jsonb_typeof(v_item->'price') is distinct from 'number' or (v_item->>'price') !~ '^[0-9]{1,9}$' then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    v_vkey := (v_item->>'productId')::uuid::text || '|' || (v_item->>'variantId');
    v_totals := jsonb_set(v_totals, array[v_vkey],
      to_jsonb(coalesce((v_totals->>v_vkey)::bigint, 0) + greatest(1, coalesce((v_item->>'qty')::integer, 1))));
  end loop;

  -- 看到的運費：必須是物件，key 是店 id（uuid），值是 0 以上的 JSON 整數；同一家店（大小寫不同）出現兩次也算格式錯
  if p_seen_shipping is null or jsonb_typeof(p_seen_shipping) <> 'object' then
    perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
  end if;
  for v_k, v_v in select key, value from jsonb_each(p_seen_shipping) loop
    if v_k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_v) is distinct from 'number' or (v_v #>> '{}') !~ '^[0-9]{1,9}$'
       or v_seen_ship ? v_k::uuid::text then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    v_seen_ship := v_seen_ship || jsonb_build_object(v_k::uuid::text, v_v);
  end loop;

  -- 掃描：照送出順序鎖列、檢查、收集問題。這一段不寫入任何東西
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    -- for update：比對在鎖列之後，快改與其他買家的下單要等這個交易結束才能動這一列
    select * into v_product from public.products p
      where p.id = (v_item->>'productId')::uuid and p.status = 'active' for update;
    if not found then
      perform public._rv_raise('PRODUCT_UNAVAILABLE', '商品不存在或已下架');
    end if;
    if exists (select 1 from public.shops s where s.id = v_product.shop_id and s.owner_id = v_uid) then
      perform public._rv_raise('OWN_SHOP', '不能購買自己商店的商品');
    end if;
    select value into v_variant from jsonb_array_elements(v_product.variants) t(value)
      where value->>'id' = v_item->>'variantId';
    if v_variant is null then
      perform public._rv_raise('VARIANT_NOT_FOUND', '規格不存在');
    end if;
    v_vkey  := v_product.id::text || '|' || (v_variant->>'id');
    v_price := (v_variant->>'price')::integer;
    v_seen  := (v_item->>'price')::integer;
    v_stock := (v_variant->>'stock')::integer;
    if v_seen <> v_price and not ((v_vkey || '|' || v_seen) = any (v_seen_px)) then
      v_seen_px := v_seen_px || (v_vkey || '|' || v_seen);
      v_changes := v_changes || jsonb_build_object('kind', 'price', 'productId', v_product.id, 'variantId', v_variant->>'id',
        'shopId', v_product.shop_id, 'title', v_product.title, 'variantName', coalesce(v_variant->>'name', ''),
        'seenPrice', v_seen, 'currentPrice', v_price);
    end if;
    if not (v_vkey = any (v_seen_qty)) then
      v_seen_qty := v_seen_qty || v_vkey;
      if (v_totals->>v_vkey)::bigint > v_stock then
        v_changes := v_changes || jsonb_build_object('kind', 'stock', 'productId', v_product.id, 'variantId', v_variant->>'id',
          'shopId', v_product.shop_id, 'title', v_product.title, 'variantName', coalesce(v_variant->>'name', ''),
          'qty', (v_totals->>v_vkey)::bigint, 'stock', v_stock);
      end if;
    end if;
    -- 目前運費的材料：目前單價 × 送出數量（庫存不足也照送出數量算，spec 4.2）、這批商品目前的免運設定。
    -- 用 bigint 算：極大數量（例如 5000 × 499,999）在 integer 會溢位成英文錯誤，而這時應該回 rejected 的 stock（小q B-2）
    v_key := v_product.shop_id::text;
    if not (v_key = any (v_shop_ord)) then v_shop_ord := v_shop_ord || v_key; end if;
    v_group := coalesce(v_ship -> v_key, jsonb_build_object('subtotal', 0, 'all_free', true));
    v_ship := jsonb_set(v_ship, array[v_key], jsonb_build_object(
      'subtotal', (v_group->>'subtotal')::bigint + v_price::bigint * v_qty,
      'all_free', (v_group->>'all_free')::boolean and v_product.free_shipping));
  end loop;

  -- 看到的運費必須剛好涵蓋這次送出的每一家店（少店、多店都是 ITEM_INVALID；raise → 回滾，沒有任何寫入）
  if (select count(*) from jsonb_object_keys(v_seen_ship)) <> cardinality(v_shop_ord)
     or exists (select 1 from unnest(v_shop_ord) s where not (v_seen_ship ? s)) then
    perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
  end if;

  -- 逐店比運費（規則同 _place_order_core）
  foreach v_key in array v_shop_ord loop
    v_group := v_ship -> v_key;
    v_fee := case when (v_group->>'subtotal')::bigint >= 499 or (v_group->>'all_free')::boolean then 0 else 60 end;
    if (v_seen_ship->>v_key)::integer <> v_fee then
      v_changes := v_changes || jsonb_build_object('kind', 'shipping', 'shopId', v_key::uuid,
        'shopName', (select s.name from public.shops s where s.id = v_key::uuid),
        'seenFee', (v_seen_ship->>v_key)::integer, 'currentFee', v_fee);
    end if;
  end loop;

  -- 下單被擋：寫失敗紀錄（寫不進去就整個呼叫失敗，不會「回 rejected 卻沒留紀錄」）後正常回傳
  if jsonb_array_length(v_changes) > 0 then
    insert into public.checkout_rejection_log
      (reason, shop_id, from_cart, product_id, variant_id, seen_value, current_value, qty, stock)
    select c->>'kind', (c->>'shopId')::uuid, coalesce(p_from_cart, false), (c->>'productId')::uuid, c->>'variantId',
           coalesce((c->>'seenPrice')::integer, (c->>'seenFee')::integer),
           coalesce((c->>'currentPrice')::integer, (c->>'currentFee')::integer),
           (c->>'qty')::bigint, (c->>'stock')::integer
      from jsonb_array_elements(v_changes) with ordinality t(c, n)
     order by n;
    return jsonb_build_object('outcome', 'rejected', 'changes', v_changes);
  end if;

  -- 成立：以下與 _place_order_core 的扣庫存、依店分單、運費、購物車移除完全相同（只多 lines[].seenPrice）。
  -- 列已在上面鎖住，庫存在這之間不會被別人改；同一規格出現多次時重新讀列，拿到前一次扣完的庫存（同舊函式）
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_product from public.products p
      where p.id = (v_item->>'productId')::uuid and p.status = 'active' for update;
    select ord - 1, value into v_idx, v_variant
      from jsonb_array_elements(v_product.variants) with ordinality as t(value, ord)
      where value->>'id' = v_item->>'variantId';
    update public.products p set
      variants = jsonb_set(p.variants, array[v_idx::text, 'stock'], to_jsonb((v_variant->>'stock')::integer - v_qty)),
      sold = p.sold + v_qty
    where p.id = v_product.id;
    v_key := v_product.shop_id::text;
    v_group := coalesce(v_groups -> v_key, jsonb_build_object('lines', '[]'::jsonb, 'subtotal', 0, 'all_free', true));
    v_groups := jsonb_set(v_groups, array[v_key], jsonb_build_object(
      'lines', (v_group -> 'lines') || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'variantId', v_variant->>'id',
        'title', v_product.title, 'variantName', v_variant->>'name',
        'image', coalesce(v_product.images->>0, ''),
        'price', (v_variant->>'price')::integer, 'qty', v_qty,
        'seenPrice', (v_item->>'price')::integer
      )),
      'subtotal', (v_group->>'subtotal')::integer + (v_variant->>'price')::integer * v_qty,
      'all_free', (v_group->>'all_free')::boolean and v_product.free_shipping
    ));
  end loop;

  -- 每家店開一張單：同店滿 499 免運，或該店這批商品都標免運（店的順序同舊函式：jsonb_each 的 key 順序）
  for v_key, v_group in select key, value from jsonb_each(v_groups) loop
    v_subtotal := (v_group->>'subtotal')::integer;
    v_shipping := case when v_subtotal >= 499 or (v_group->>'all_free')::boolean then 0 else 60 end;
    insert into public.orders (shop_id, lines, shipping_fee, total, buyer_name, buyer_phone, buyer_address, payment, buyer_id)
    values (v_key::uuid, v_group -> 'lines', v_shipping, v_subtotal + v_shipping,
            p_buyer->>'name', p_buyer->>'phone', p_buyer->>'address', p_payment, v_uid)
    returning * into v_order;
    v_orders := v_orders || to_jsonb((v_order.id, v_order.order_no, v_order.shop_id, v_order.lines, v_order.shipping_fee,
      v_order.total, v_order.status, v_order.payment, v_order.carrier, v_order.tracking_no, v_order.events,
      v_order.created_at)::public.buyer_order);
  end loop;

  -- 從購物車結帳 → 已下單的品項從帳號購物車移除；直接購買不動購物車
  if coalesce(p_from_cart, false) then
    delete from public.cart_items c
     using jsonb_array_elements(p_items) i
     where c.user_id = v_uid
       and c.product_id = (i.value->>'productId')::uuid
       and c.variant_id = i.value->>'variantId';
  end if;
  return jsonb_build_object('outcome', 'ok', 'orders', v_orders);
end $$;

-- ──────────────────────────── 函式權限 ────────────────────────────
revoke all on function public.place_checked_order(jsonb, jsonb, text, boolean, jsonb) from public;
grant execute on function public.place_checked_order(jsonb, jsonb, text, boolean, jsonb) to anon, authenticated;

-- ──────────────────────────── 自我檢查：不如預期就整個回滾 ────────────────────────────
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not has_function_privilege(r, 'public.place_checked_order(jsonb,jsonb,text,boolean,jsonb)', 'execute') then
      raise exception '結帳比價自我檢查失敗：% 不能執行 place_checked_order，整個交易回滾', r;
    end if;
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.checkout_rejection_log', p) then
        raise exception '結帳比價自我檢查失敗：% 對 checkout_rejection_log 有 % 權限，整個交易回滾', r, p;
      end if;
    end loop;
    foreach p in array array['usage', 'select', 'update'] loop
      if has_sequence_privilege(r, 'public.checkout_rejection_log_id_seq', p) then
        raise exception '結帳比價自我檢查失敗：% 對 checkout_rejection_log_id_seq 有 % 權限，整個交易回滾', r, p;
      end if;
    end loop;
    -- 內部函式維持不開放
    if has_function_privilege(r, 'public._place_order_core(jsonb,jsonb,text,uuid,boolean)', 'execute')
       or has_function_privilege(r, 'public._acct_uid(text)', 'execute')
       or has_function_privilege(r, 'public._rv_raise(text,text)', 'execute') then
      raise exception '結帳比價自我檢查失敗：% 可以執行內部函式，整個交易回滾', r;
    end if;
    -- 舊函式維持可執行（buyer_accounts_m2 的自我檢查寫死了這一條；舊前端還在用）
    if not has_function_privilege(r, 'public.place_account_order(jsonb,jsonb,text,boolean)', 'execute') then
      raise exception '結帳比價自我檢查失敗：% 不能執行 place_account_order，整個交易回滾', r;
    end if;
  end loop;
  if exists (select 1 from pg_proc pr, aclexplode(pr.proacl) a
              where pr.oid = 'public.place_checked_order(jsonb,jsonb,text,boolean,jsonb)'::regprocedure and a.grantee = 0) then
    raise exception '結帳比價自我檢查失敗：PUBLIC 仍可執行 place_checked_order，整個交易回滾';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.checkout_rejection_log'::regclass) then
    raise exception '結帳比價自我檢查失敗：checkout_rejection_log 沒有啟用 RLS，整個交易回滾';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'place_checked_order') <> 1 then
    raise exception '結帳比價自我檢查失敗：place_checked_order 有多載（PostgREST 會 PGRST203），整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
