-- 「我的商品」列表快改：只改被改的價格／庫存（.work/list-quick-edit/spec.md v0.2，工單 T-2；決策 D-2、D-5、D-10）
--
-- 新增（全部是相容的新增，不改任何既有函式、欄位、權限）：
--   1. 表 product_change_log：價格／庫存／狀態的異動紀錄。店主只能讀自己店的；沒有人能經由 API 改或刪。
--   2. 函式 quick_edit_product(uuid, jsonb)：快改的唯一入口。
--        · 檢查呼叫者是商品所屬商店的店主（R-8）
--        · for update 鎖住商品列，跟下單函式（place_account_order 的 _place_order_core）鎖同一列，所以兩邊互相等
--        · 逐一比對賣家看到的舊值（expected）和目前值；任何一個不同 → 整筆不寫，回 conflict（R-4）
--        · 驗證被改的值（R-1、R-5：沒被改的規格不驗，匯入商品的超大庫存不會卡住）
--        · 只用 jsonb_set 改被改的鍵；原價清空＝移除 originalPrice 鍵（R-3）
--        · 這次有實際改到庫存、寫完所有規格庫存都是 0、而且商品原本是 active → 同一個交易改成 hidden（D-5、R-6）
--        · 寫異動紀錄（R-7）；紀錄寫入失敗＝整個交易回滾，快改不成立
--   3. 內部函式 _qe_raise、_qe_num、_qe_is_whole、_qe_log：不開放給前端。
-- 介面與錯誤碼：.work/list-quick-edit/interface.md
--
-- 可重複執行。整個檔案包在一個交易裡，任何一步失敗就整個回滾。

begin;

-- ──────────────────────────── 異動紀錄表 ────────────────────────────

create table if not exists public.product_change_log (
  id           bigint generated always as identity primary key,   -- 遞增：同一毫秒內的先後也分得出來
  created_at   timestamptz not null default clock_timestamp(),    -- 精確到微秒（不是交易開始時間）
  tx_id        bigint not null default txid_current(),            -- 同一次呼叫（同一個交易）寫的紀錄 tx_id 相同；統計「幾次快改」用
  shop_id      uuid not null references public.shops(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,   -- 商品被刪後紀錄還在，靠下面兩個快照辨識
  product_title text,
  actor_id     uuid references auth.users(id) on delete set null,       -- 誰：呼叫者的 auth.uid()
  variant_id   text,                                                     -- 規格 id；field='status' 時為 null
  variant_name text,                                                     -- 當時的規格名稱快照
  field        text not null check (field in ('price', 'original_price', 'stock', 'status')),
  old_value    jsonb,   -- applied＝改之前的值；conflict＝衝突當下資料庫裡的值。沒有值（例如沒有原價）＝SQL null
  new_value    jsonb,   -- applied＝改之後的值；conflict＝賣家想寫的值。原價被清空＝SQL null
  seen_value   jsonb,   -- 賣家開始改時看到的值（applied 時等於 old_value）
  source       text not null default 'quick_edit' check (source in ('quick_edit')),
  result       text not null check (result in ('applied', 'conflict'))
);

create index if not exists product_change_log_shop_idx    on public.product_change_log (shop_id, created_at desc);
create index if not exists product_change_log_product_idx on public.product_change_log (product_id, created_at desc);

-- RLS：只有該店店主讀得到；沒有任何 insert／update／delete 政策，寫入只經由 quick_edit_product（security definer）
alter table public.product_change_log enable row level security;

drop policy if exists product_change_log_read_own on public.product_change_log;
create policy product_change_log_read_own on public.product_change_log for select to authenticated
  using (exists (select 1 from public.shops s where s.id = product_change_log.shop_id and s.owner_id = auth.uid()));

-- 預設權限會把新表全開給 anon／authenticated，這裡收回，只留 authenticated 的讀取（再由 RLS 限店主）
revoke all on public.product_change_log from public, anon, authenticated;
grant select on public.product_change_log to authenticated;

-- ──────────────────────────── 內部工具函式 ────────────────────────────

-- 呼叫層錯誤：message＝中文說明、hint＝機器代碼（supabase-js 的 error.message／error.hint）
create or replace function public._qe_raise(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception '%', p_message using hint = p_code;
end $$;

-- JSON 數字 → numeric；不是 JSON 數字（字串、布林、null、不存在）→ null
create or replace function public._qe_num(p jsonb)
returns numeric language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end
$$;

-- 是 JSON 數字而且是整數（12.5、"12"、true、null 都不是）
create or replace function public._qe_is_whole(p jsonb)
returns boolean language sql immutable as $$
  select coalesce(public._qe_num(p) = trunc(public._qe_num(p)), false)
$$;

-- 寫異動紀錄。p_rows 是 [{ variantId, variantName, field, old, new, seen, result }]
create or replace function public._qe_log(p_shop uuid, p_product uuid, p_title text, p_actor uuid, p_rows jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.product_change_log
    (shop_id, product_id, product_title, actor_id, variant_id, variant_name, field,
     old_value, new_value, seen_value, source, result)
  select p_shop, p_product, p_title, p_actor, r->>'variantId', r->>'variantName', r->>'field',
         nullif(r->'old', 'null'::jsonb), nullif(r->'new', 'null'::jsonb), nullif(r->'seen', 'null'::jsonb),
         'quick_edit', r->>'result'
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
   order by ord
$$;

-- ──────────────────────────── quick_edit_product ────────────────────────────
-- p_changes：[{ "variantId": "s1", "field": "price"|"original_price"|"stock", "expected": <賣家看到的舊值>, "value": <新值> }]
--   · expected：price／stock 必須是數字；original_price 沒有原價時給 null
--   · value：price／stock 是整數；original_price 給 null＝清空原價（移除 originalPrice 鍵）
-- 回傳 jsonb，outcome 三種：
--   ok       { outcome, productId, status, autoHidden, variants, changed:[{variantId,field,old,new}] }
--   conflict { outcome, productId, status, variants(目前的), conflicts:[{variantId,variantName,field,seen,current,attempted}] }
--   invalid  { outcome, errors:[{code,variantId,field,message}] }
-- 其餘（沒登入、不是店主、請求格式錯、規格不存在）用 raise exception，hint＝代碼，格式同其他 RPC。
create or replace function public.quick_edit_product(p_product_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_shop      uuid;
  v_prod      public.products%rowtype;
  v_new       jsonb;                      -- 工作副本：從鎖住的那一列出發，只對被改的鍵動手
  v_c         jsonb;
  v_vid       text;
  v_field     text;
  v_key       text;
  v_val       jsonb;
  v_cur       jsonb;
  v_idx       integer;
  v_var       jsonb;
  v_seen      text[] := '{}';
  v_errors    jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_changed   jsonb := '[]'::jsonb;
  v_log       jsonb := '[]'::jsonb;
  v_touched   text[] := '{}';             -- 價格或原價有被改的規格 id，用來檢查「原價要高於售價」
  v_stock_chg boolean := false;
  v_status    text;
  v_auto      boolean := false;
  v_p         numeric;
  v_o         numeric;
begin
  -- 1. 身分
  if v_uid is null then
    perform public._qe_raise('NOT_AUTHENTICATED', '請先登入');
  end if;
  select s.id into v_shop from public.shops s where s.owner_id = v_uid;
  if v_shop is null then
    perform public._qe_raise('NO_SHOP', '你還沒有開店');
  end if;

  -- 2. 請求格式（還沒碰資料）
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 100 then
    perform public._qe_raise('CHANGES_INVALID', '資料有誤，請重新整理');
  end if;
  for v_c in select * from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_c) <> 'object'
       or jsonb_typeof(v_c->'variantId') is distinct from 'string' or (v_c->>'variantId') = ''
       or (v_c->>'field') is null or (v_c->>'field') not in ('price', 'original_price', 'stock')
       or not (v_c ? 'expected') or not (v_c ? 'value') then
      perform public._qe_raise('CHANGES_INVALID', '資料有誤，請重新整理');
    end if;
    -- 賣家看到的舊值：price／stock 一定是數字；原價可以是數字或 null（沒有原價）
    if jsonb_typeof(v_c->'expected') is distinct from 'number'
       and not ((v_c->>'field') = 'original_price' and jsonb_typeof(v_c->'expected') = 'null') then
      perform public._qe_raise('CHANGES_INVALID', '資料有誤，請重新整理');
    end if;
    if (v_c->>'variantId') || '|' || (v_c->>'field') = any (v_seen) then
      perform public._qe_raise('CHANGES_INVALID', '資料有誤，請重新整理');   -- 同一規格同一欄位不能出現兩次
    end if;
    v_seen := v_seen || ((v_c->>'variantId') || '|' || (v_c->>'field'));
  end loop;

  -- 3. 鎖列。where 帶 shop_id：不是自己店的商品和不存在的商品一樣回 PRODUCT_NOT_FOUND，不洩漏存在與否
  select * into v_prod from public.products p
    where p.id = p_product_id and p.shop_id = v_shop for update;
  if not found then
    perform public._qe_raise('PRODUCT_NOT_FOUND', '找不到這件商品');
  end if;
  if jsonb_typeof(v_prod.variants) is distinct from 'array' then
    perform public._qe_raise('VARIANT_NOT_FOUND', '規格已不存在，請重新整理');
  end if;
  v_new := v_prod.variants;

  -- 4. 規格都要存在；驗證「被改的值」（R-1、R-5：不看沒被改的規格）
  for v_c in select * from jsonb_array_elements(p_changes) loop
    v_vid := v_c->>'variantId'; v_field := v_c->>'field'; v_val := v_c->'value';
    if not exists (select 1 from jsonb_array_elements(v_prod.variants) x where x->>'id' = v_vid) then
      perform public._qe_raise('VARIANT_NOT_FOUND', '規格已不存在，請重新整理');
    end if;

    if v_field = 'price' then
      if not public._qe_is_whole(v_val) or public._qe_num(v_val) < 1 then
        v_errors := v_errors || jsonb_build_object('code', 'PRICE_INVALID', 'variantId', v_vid, 'field', v_field,
                      'message', '售價要是大於 0 的整數');
      elsif public._qe_num(v_val) > 499999 then
        v_errors := v_errors || jsonb_build_object('code', 'PRICE_TOO_HIGH', 'variantId', v_vid, 'field', v_field,
                      'message', '售價最高 $499,999');
      end if;
    elsif v_field = 'stock' then
      if not public._qe_is_whole(v_val) or public._qe_num(v_val) < 0 then
        v_errors := v_errors || jsonb_build_object('code', 'STOCK_INVALID', 'variantId', v_vid, 'field', v_field,
                      'message', '庫存要是 0 以上的整數');
      elsif public._qe_num(v_val) > 999999 then
        v_errors := v_errors || jsonb_build_object('code', 'STOCK_TOO_HIGH', 'variantId', v_vid, 'field', v_field,
                      'message', '庫存最高 999,999');
      end if;
    else  -- original_price：null＝清空，合法
      if jsonb_typeof(v_val) is distinct from 'null' then
        if not public._qe_is_whole(v_val) or public._qe_num(v_val) < 1 then
          v_errors := v_errors || jsonb_build_object('code', 'ORIGINAL_INVALID', 'variantId', v_vid, 'field', v_field,
                        'message', '原價要是大於 0 的整數，不填就留空');
        elsif public._qe_num(v_val) > 499999 then
          v_errors := v_errors || jsonb_build_object('code', 'ORIGINAL_TOO_HIGH', 'variantId', v_vid, 'field', v_field,
                        'message', '原價最高 $499,999');
        end if;
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('outcome', 'invalid', 'errors', v_errors);
  end if;

  -- 5. 比對舊值（R-4）。已經持有鎖，所以這裡讀到的就是這個交易寫入時的值
  for v_c in select * from jsonb_array_elements(p_changes) loop
    v_vid := v_c->>'variantId'; v_field := v_c->>'field';
    v_key := case v_field when 'original_price' then 'originalPrice' else v_field end;
    select value into v_var from jsonb_array_elements(v_prod.variants) x(value) where value->>'id' = v_vid;
    v_cur := case when jsonb_typeof(v_var->v_key) = 'number' then v_var->v_key end;   -- 沒有或不是數字＝null
    if public._qe_num(v_c->'expected') is distinct from public._qe_num(v_cur) then
      v_conflicts := v_conflicts || jsonb_build_object('variantId', v_vid, 'variantName', v_var->>'name', 'field', v_field,
                       'seen', v_c->'expected', 'current', v_cur, 'attempted', v_c->'value');
      v_log := v_log || jsonb_build_object('variantId', v_vid, 'variantName', v_var->>'name', 'field', v_field,
                  'old', v_cur, 'new', v_c->'value', 'seen', v_c->'expected', 'result', 'conflict');
    end if;
  end loop;
  if jsonb_array_length(v_conflicts) > 0 then
    -- 衝突也留一筆紀錄；這裡是正常 return（不是 raise），所以紀錄會 commit，資料本身一個字都沒動
    perform public._qe_log(v_shop, v_prod.id, v_prod.title, v_uid, v_log);
    return jsonb_build_object('outcome', 'conflict', 'productId', v_prod.id, 'status', v_prod.status,
                              'variants', v_prod.variants, 'conflicts', v_conflicts);
  end if;

  -- 6. 套用到工作副本：只 jsonb_set 被改的鍵（R-3）
  for v_c in select * from jsonb_array_elements(p_changes) loop
    v_vid := v_c->>'variantId'; v_field := v_c->>'field'; v_val := v_c->'value';
    v_key := case v_field when 'original_price' then 'originalPrice' else v_field end;
    select ord - 1, value into v_idx, v_var
      from jsonb_array_elements(v_new) with ordinality as t(value, ord) where value->>'id' = v_vid;
    v_cur := case when jsonb_typeof(v_var->v_key) = 'number' then v_var->v_key end;

    if public._qe_num(v_val) is not distinct from public._qe_num(v_cur) then
      continue;   -- 值沒有實際改變：不寫、不記
    end if;

    if jsonb_typeof(v_val) = 'null' then
      v_new := v_new #- array[v_idx::text, v_key];                                   -- 清空原價＝移除鍵
    else
      v_new := jsonb_set(v_new, array[v_idx::text, v_key], to_jsonb(trunc(public._qe_num(v_val))::bigint));
    end if;

    if v_field = 'stock' then v_stock_chg := true; else v_touched := v_touched || v_vid; end if;
    v_changed := v_changed || jsonb_build_object('variantId', v_vid, 'field', v_field, 'old', v_cur,
                   'new', case when jsonb_typeof(v_val) = 'null' then null else to_jsonb(trunc(public._qe_num(v_val))::bigint) end);
  end loop;

  -- 7. 原價要高於售價：只檢查這次動到價格或原價的規格，用「寫完之後」的值（R-5：其他規格不管）
  for v_vid in select distinct unnest(v_touched) loop
    select value into v_var from jsonb_array_elements(v_new) x(value) where value->>'id' = v_vid;
    v_p := public._qe_num(v_var->'price');
    v_o := public._qe_num(v_var->'originalPrice');
    -- 沒有原價＝鍵不存在、null、或 ≤ 0（匯入的商品常見 0；同前端 discountOf 把 0 當沒有原價）→ 不檢查
    if v_o is not null and v_o > 0 and v_p is not null and v_o <= v_p then
      v_errors := v_errors || jsonb_build_object('code', 'ORIGINAL_NOT_ABOVE_PRICE', 'variantId', v_vid,
                    'field', 'original_price', 'message', '原價要高於同一列的售價，否則請留空',
                    'originalPrice', trunc(v_o)::bigint, 'price', trunc(v_p)::bigint);   -- 資料庫目前的原價與寫完會是的售價，前端用來顯示「售價要低於原價 $X」
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('outcome', 'invalid', 'errors', v_errors);
  end if;

  -- 8. 沒有實際變動 → 直接回成功，不寫任何東西
  if jsonb_array_length(v_changed) = 0 then
    return jsonb_build_object('outcome', 'ok', 'productId', v_prod.id, 'status', v_prod.status,
                              'autoHidden', false, 'variants', v_prod.variants, 'changed', '[]'::jsonb);
  end if;

  -- 9. 自動下架（D-5）：這次有實際改到庫存、寫完所有規格庫存都是 0、原本是上架 → 同一個交易改成 hidden
  --    庫存不是數字的規格視為 0（同蝦皮匯入 Q-2 的寫法）
  v_status := v_prod.status;
  if v_stock_chg and v_prod.status = 'active'
     and not exists (select 1 from jsonb_array_elements(v_new) x where coalesce(public._qe_num(x->'stock'), 0) > 0) then
    v_status := 'hidden';
    v_auto := true;
  end if;

  update public.products set variants = v_new, status = v_status where id = v_prod.id;

  -- 10. 異動紀錄。任何一筆寫失敗都會讓整個函式 raise → 連上面的 update 一起回滾（R-7）
  v_log := '[]'::jsonb;
  for v_c in select * from jsonb_array_elements(v_changed) loop
    select value into v_var from jsonb_array_elements(v_new) x(value) where value->>'id' = v_c->>'variantId';
    v_log := v_log || jsonb_build_object('variantId', v_c->>'variantId', 'variantName', v_var->>'name',
               'field', v_c->>'field', 'old', v_c->'old', 'new', v_c->'new', 'seen', v_c->'old', 'result', 'applied');
  end loop;
  if v_auto then
    v_log := v_log || jsonb_build_object('field', 'status', 'old', to_jsonb(v_prod.status), 'new', to_jsonb(v_status),
               'seen', to_jsonb(v_prod.status), 'result', 'applied');
  end if;
  perform public._qe_log(v_shop, v_prod.id, v_prod.title, v_uid, v_log);

  return jsonb_build_object('outcome', 'ok', 'productId', v_prod.id, 'status', v_status,
                            'autoHidden', v_auto, 'variants', v_new, 'changed', v_changed);
end $$;

-- ──────────────────────────── 函式權限 ────────────────────────────
-- 預設權限會把新函式開給 anon／authenticated：內部工具函式全部收回。
-- quick_edit_product 刻意留給 anon 執行：沒登入的人得到中文的 NOT_AUTHENTICATED，不是英文的 permission denied（同其他 RPC）。
revoke all on function public._qe_raise(text, text)                              from public, anon, authenticated;
revoke all on function public._qe_num(jsonb)                                     from public, anon, authenticated;
revoke all on function public._qe_is_whole(jsonb)                                from public, anon, authenticated;
revoke all on function public._qe_log(uuid, uuid, text, uuid, jsonb)             from public, anon, authenticated;
revoke all on function public.quick_edit_product(uuid, jsonb)                    from public;
grant execute on function public.quick_edit_product(uuid, jsonb)                 to anon, authenticated;

-- 自我檢查：權限不如預期就整個回滾
do $$
declare
  f text;
  r text;
begin
  foreach f in array array['public._qe_raise(text,text)', 'public._qe_num(jsonb)',
                           'public._qe_is_whole(jsonb)', 'public._qe_log(uuid,uuid,text,uuid,jsonb)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception 'quick-edit 自我檢查失敗：% 仍可執行 %，整個交易回滾', r, f;
      end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if not has_function_privilege(r, 'public.quick_edit_product(uuid,jsonb)', 'execute') then
      raise exception 'quick-edit 自我檢查失敗：% 不能執行 quick_edit_product，整個交易回滾', r;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.product_change_log', 'select')
     or has_table_privilege('authenticated', 'public.product_change_log', 'insert')
     or has_table_privilege('authenticated', 'public.product_change_log', 'update')
     or has_table_privilege('authenticated', 'public.product_change_log', 'delete')
     or has_table_privilege('authenticated', 'public.product_change_log', 'truncate')
     or not has_table_privilege('authenticated', 'public.product_change_log', 'select') then
    raise exception 'quick-edit 自我檢查失敗：product_change_log 的權限不對，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
