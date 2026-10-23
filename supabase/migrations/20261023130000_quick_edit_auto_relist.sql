-- 快改補貨自動上架（.work/list-quick-edit/spec-auto-relist.md；決策 D-5 修訂、D-11～D-13，使用者 2026-10-23 拍板）
--
-- 行為：快改自動下架（庫存全 0）的商品，之後用快改把任一規格從 0 改成 > 0 時，同一個交易自動改回上架。
--       手動下架（前端直接 update products set status，不經快改、不寫 product_change_log）的商品補貨，仍不自動上架。
--
-- 新增（全部是相容的新增；舊前端只讀 status／autoHidden，多出來的鍵與欄位不影響 → 先套資料庫再推前端）：
--   1. 欄位 products.auto_hidden boolean not null default false：「目前的下架是不是快改自動下架造成的」。
--   2. 觸發器 products_qe_auto_hidden（before insert or update）＋函式 _qe_auto_hidden_flag()：旗標只能由它維護。
--        · insert：一律 false（不能在新增時夾帶 true）
--        · status 有變：auto_hidden := (新狀態是 hidden 且 這個交易設了 goodmarket.qe_auto_hide = 'on')。
--          只有 quick_edit_product 的自動下架那次 update 會設 'on'；手動上下架、編輯頁、匯入都不會 → 旗標被清成 false
--        · status 沒變：auto_hidden 保持舊值（任何人直接寫這個欄位都無效；只改價格／庫存不會動到旗標）
--   3. quick_edit_product(uuid, jsonb) 以 create or replace 重建（簽名、權限不變），只改第 8、9、10 步：
--        · 第 8 步（沒有實際變動）的回傳多 autoRelisted:false
--        · 第 9 步：自動下架前設 goodmarket.qe_auto_hide='on'（update 後還原）；新增自動上架判斷
--        · 第 10 步：自動上架時異動紀錄多一筆 field='status', hidden→active（格式同自動下架那筆）
--        · 回傳多 autoRelisted（autoHidden 保留）。衝突、invalid 回應不變
--   4. 權限：不改既有 grant；auto_hidden 跟著 products 既有 select 權限走，不另開寫入（寫了也會被觸發器蓋掉）。
--      內部觸發器函式對 anon／authenticated 收回 execute。
-- 介面：.work/list-quick-edit/interface.md
--
-- 可重複執行。整個檔案包在一個交易裡，任何一步失敗就整個回滾。

begin;

-- ──────────────────────────── 旗標欄位 ────────────────────────────

alter table public.products add column if not exists auto_hidden boolean not null default false;

-- ──────────────────────────── 觸發器：旗標只由這裡維護 ────────────────────────────

create or replace function public._qe_auto_hidden_flag()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.auto_hidden := false;                       -- 旗標只能由快改的自動下架設成 true
  elsif new.status is distinct from old.status then
    -- coalesce：新連線從沒設過這個值時 current_setting(..., true) 回 null，沒有 coalesce 整個運算式會是 null → 違反 not null
    new.auto_hidden := coalesce(new.status = 'hidden' and current_setting('goodmarket.qe_auto_hide', true) = 'on', false);
  else
    new.auto_hidden := old.auto_hidden;             -- 狀態沒變：保持原值，直接寫這個欄位無效
  end if;
  return new;
end $$;

drop trigger if exists products_qe_auto_hidden on public.products;
create trigger products_qe_auto_hidden
  before insert or update on public.products
  for each row execute function public._qe_auto_hidden_flag();

revoke all on function public._qe_auto_hidden_flag() from public, anon, authenticated;

-- ──────────────────────────── quick_edit_product ────────────────────────────
-- p_changes、p_product_id 與錯誤碼同 20261018163000_list_quick_edit.sql；回傳 outcome 三種：
--   ok       { outcome, productId, status, autoHidden, autoRelisted, variants, changed:[{variantId,field,old,new}] }
--   conflict { outcome, productId, status, variants(目前的), conflicts:[{variantId,variantName,field,seen,current,attempted}] }
--   invalid  { outcome, errors:[{code,variantId,field,message}] }
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
  v_relist    boolean := false;
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
                              'autoHidden', false, 'autoRelisted', false, 'variants', v_prod.variants, 'changed', '[]'::jsonb);
  end if;

  -- 9. 自動下架／自動上架（D-5 與 2026-10-23 修訂 D-11～D-13）。兩者只在「這次有實際改到庫存」時發生，互斥（一個要 active、一個要 hidden）
  --    庫存不是數字的規格視為 0（同蝦皮匯入 Q-2 的寫法）
  --    · 自動下架：原本是上架、寫完所有規格庫存都是 0 → 改成 hidden，並讓觸發器把 auto_hidden 設為 true
  --    · 自動上架：原本是 hidden 而且 auto_hidden = true（＝之前被這個函式自動下架、之後沒有人手動動過狀態）、
  --      這次有任一被改的規格庫存「從 0 變成 > 0」（D-13 字面：補貨才算，5→4 這種調整不算）→ 改成 active，
  --      觸發器把 auto_hidden 清成 false。手動下架的商品（auto_hidden = false）補貨不上架
  v_status := v_prod.status;
  if v_stock_chg and v_prod.status = 'active'
     and not exists (select 1 from jsonb_array_elements(v_new) x where coalesce(public._qe_num(x->'stock'), 0) > 0) then
    v_status := 'hidden';
    v_auto := true;
  elsif v_prod.status = 'hidden' and v_prod.auto_hidden
     and exists (select 1 from jsonb_array_elements(v_changed) c
                  where c->>'field' = 'stock' and coalesce(public._qe_num(c->'old'), 0) = 0 and public._qe_num(c->'new') > 0) then
    v_status := 'active';
    v_relist := true;
  end if;

  -- 只有自動下架那次 update 才讓觸發器把 auto_hidden 設成 true；用完立刻還原，避免同一個交易裡後面的 update 被誤認
  if v_auto then
    perform set_config('goodmarket.qe_auto_hide', 'on', true);
  end if;
  update public.products set variants = v_new, status = v_status where id = v_prod.id;
  perform set_config('goodmarket.qe_auto_hide', 'off', true);

  -- 10. 異動紀錄。任何一筆寫失敗都會讓整個函式 raise → 連上面的 update 一起回滾（R-7）
  v_log := '[]'::jsonb;
  for v_c in select * from jsonb_array_elements(v_changed) loop
    select value into v_var from jsonb_array_elements(v_new) x(value) where value->>'id' = v_c->>'variantId';
    v_log := v_log || jsonb_build_object('variantId', v_c->>'variantId', 'variantName', v_var->>'name',
               'field', v_c->>'field', 'old', v_c->'old', 'new', v_c->'new', 'seen', v_c->'old', 'result', 'applied');
  end loop;
  if v_auto or v_relist then   -- 自動下架 active→hidden、自動上架 hidden→active，同一種格式
    v_log := v_log || jsonb_build_object('field', 'status', 'old', to_jsonb(v_prod.status), 'new', to_jsonb(v_status),
               'seen', to_jsonb(v_prod.status), 'result', 'applied');
  end if;
  perform public._qe_log(v_shop, v_prod.id, v_prod.title, v_uid, v_log);

  return jsonb_build_object('outcome', 'ok', 'productId', v_prod.id, 'status', v_status,
                            'autoHidden', v_auto, 'autoRelisted', v_relist, 'variants', v_new, 'changed', v_changed);
end $$;

-- 函式權限沿用 20261018163000（create or replace 不會動既有權限），這裡不重複 grant／revoke；由下面的自我檢查把關。

-- 自我檢查：不符就整個回滾
do $$
declare
  r text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'products' and column_name = 'auto_hidden'
                    and data_type = 'boolean' and is_nullable = 'NO') then
    raise exception 'auto-relist 自我檢查失敗：products.auto_hidden 不存在或型別不對，整個交易回滾';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.products'::regclass and tgname = 'products_qe_auto_hidden'
                    and tgenabled = 'O' and not tgisinternal) then
    raise exception 'auto-relist 自我檢查失敗：觸發器 products_qe_auto_hidden 不存在或沒啟用，整個交易回滾';
  end if;
  if position('autoRelisted' in pg_get_functiondef('public.quick_edit_product(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'auto-relist 自我檢查失敗：quick_edit_product 本體沒有 autoRelisted，整個交易回滾';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public._qe_auto_hidden_flag()', 'execute') then
      raise exception 'auto-relist 自我檢查失敗：% 仍可執行 _qe_auto_hidden_flag，整個交易回滾', r;
    end if;
    if not has_function_privilege(r, 'public.quick_edit_product(uuid,jsonb)', 'execute') then
      raise exception 'auto-relist 自我檢查失敗：% 不能執行 quick_edit_product，整個交易回滾', r;
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
