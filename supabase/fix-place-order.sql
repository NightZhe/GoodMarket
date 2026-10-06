-- 先移除舊函式
drop function if exists public.place_order(jsonb, jsonb, text);

create or replace function public.place_order(p_items jsonb, p_buyer jsonb, p_payment text)
returns table (id uuid, access_token text, shop_id uuid, lines jsonb, shipping_fee integer, total integer, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_variant  jsonb;
  v_idx      integer;
  v_qty      integer;
  -- 依商店分組的累積結果：{ "<shop_id>": { lines, subtotal, all_free } }
  v_groups   jsonb := '{}'::jsonb;
  v_group    jsonb;
  v_key      text;
  v_subtotal integer;
  v_shipping integer;
  v_order    public.orders%rowtype;
begin
  if p_payment not in ('cod', 'card', 'transfer') then
    raise exception '付款方式不正確';
  end if;
  if coalesce(p_buyer->>'name', '') = '' or coalesce(p_buyer->>'phone', '') = ''
     or coalesce(p_buyer->>'address', '') = '' then
    raise exception '收件資訊不完整';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception '沒有要結帳的商品';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));

    -- for update：鎖住這一列，同時間另一筆訂單要等這筆做完才能扣同一份庫存
    select * into v_product from public.products p
      where p.id = (v_item->>'productId')::uuid and p.status = 'active' for update;
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
    update public.products p set
      variants = jsonb_set(p.variants, array[v_idx::text, 'stock'],
                           to_jsonb((v_variant->>'stock')::integer - v_qty)),
      sold = p.sold + v_qty
    where p.id = v_product.id;

    -- 累積到該商店的明細
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

    insert into public.orders (shop_id, lines, shipping_fee, total, buyer_name, buyer_phone, buyer_address, payment)
    values (v_key::uuid, v_group -> 'lines', v_shipping, v_subtotal + v_shipping,
            p_buyer->>'name', p_buyer->>'phone', p_buyer->>'address', p_payment)
    returning * into v_order;

    id := v_order.id; access_token := v_order.access_token; shop_id := v_order.shop_id;
    lines := v_order.lines; shipping_fee := v_order.shipping_fee; total := v_order.total;
    created_at := v_order.created_at;
    return next;
  end loop;
end $$;

grant execute on function public.place_order(jsonb, jsonb, text) to anon, authenticated;

select proname, position('temp table' in prosrc) > 0 as still_old
from pg_proc where proname = 'place_order';
