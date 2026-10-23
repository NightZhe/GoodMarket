-- 蝦皮匯入：一次上限 500 → 5,000 件 ＋ 斷點續傳（規格 .work/import-5000-resume/spec.md 第 3 節，工單 T-B）
-- 基礎：20261015010000_shopee_import.sql。本檔只做「新增與相容修改」：
--   · 舊前端（2 參數版 import_products_batch、start 不帶 categoryOverrides）照常可用
--   · 全部可重複執行（create or replace／if not exists／先查 pg_constraint 再 drop+add）
--   · 只改結構與函式，不寫入、不刪除任何資料

-- ──────────────────────────── 3.1 件數上限 5,000 ────────────────────────────
-- 約束名稱不寫死（基準環境由 inline check 自動命名）：依定義找出 total_products 的 check。
-- 已經是 5000 的保留（重跑不動它）；其餘 drop 後以固定名稱重建。

do $$
declare
  c     record;
  v_has boolean := false;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.product_imports'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%total_products%'
  loop
    if c.def like '%5000%' then
      v_has := true;
    else
      execute format('alter table public.product_imports drop constraint %I', c.conname);
    end if;
  end loop;
  if not v_has then
    alter table public.product_imports
      add constraint product_imports_total_products_check check (total_products between 1 and 5000);
  end if;
end $$;

-- ──────────────────────────── 3.2 分類修改（續傳時還原） ────────────────────────────
-- { "<sourceProductId>": "<categoryId>" }：賣家在預覽改過的分類

alter table public.product_imports
  add column if not exists category_overrides jsonb not null default '{}'::jsonb;

-- ──────────────────────────── 內部工具函式（新增） ────────────────────────────

-- 驗證前端回報格式（clientFailures／skippedImages）。與 finish_product_import 原本的檢查完全相同。
create or replace function public._imp_check_report(p_client_failures jsonb, p_skipped_images jsonb)
returns void language plpgsql as $$
begin
  if p_client_failures is null or jsonb_typeof(p_client_failures) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_client_failures) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'sourceProductId') is distinct from 'string'
                    or jsonb_typeof(f->'code') is distinct from 'string'
                    or jsonb_typeof(f->'message') is distinct from 'string') then
    perform public._imp_raise('INVALID_PAYLOAD', 'client failures 格式不正確');
  end if;
  if p_skipped_images is null or jsonb_typeof(p_skipped_images) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_skipped_images) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'sourceProductId') is distinct from 'string'
                    or jsonb_typeof(f->'slot') is distinct from 'string'
                    or jsonb_typeof(f->'sourceUrl') is distinct from 'string'
                    or coalesce(f->>'code', '') not in ('IMAGE_DOWNLOAD_FAILED', 'IMAGE_UPLOAD_FAILED')) then
    perform public._imp_raise('INVALID_PAYLOAD', 'skipped images 格式不正確');
  end if;
end $$;

-- 合併 clientFailures：以 sourceProductId 去重，同 id 以新的（p_new 後面的）覆蓋；輸出依 id 排序（同輸入重送結果相同）。
-- 只保留 sourceProductId／code／message 三個欄位。
create or replace function public._imp_merge_failures(p_old jsonb, p_new jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(d.x order by d.sid), '[]'::jsonb)
    from (
      select distinct on (q.sid) q.sid, q.x
        from (
          select e->>'sourceProductId' as sid,
                 jsonb_build_object('sourceProductId', e->>'sourceProductId', 'code', e->>'code', 'message', e->>'message') as x,
                 0 as pri, t.ord
            from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) with ordinality as t(e, ord)
          union all
          select e->>'sourceProductId',
                 jsonb_build_object('sourceProductId', e->>'sourceProductId', 'code', e->>'code', 'message', e->>'message'),
                 1, t.ord
            from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) with ordinality as t(e, ord)
        ) q
       order by q.sid, q.pri desc, q.ord desc
    ) d;
$$;

-- 合併 skippedImages：以 (sourceProductId, slot) 去重，同鍵以新的覆蓋；輸出依 (id, slot) 排序。
create or replace function public._imp_merge_skipped(p_old jsonb, p_new jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(d.x order by d.sid, d.slot), '[]'::jsonb)
    from (
      select distinct on (q.sid, q.slot) q.sid, q.slot, q.x
        from (
          select e->>'sourceProductId' as sid, e->>'slot' as slot,
                 jsonb_build_object('sourceProductId', e->>'sourceProductId', 'slot', e->>'slot',
                                    'sourceUrl', e->>'sourceUrl', 'code', e->>'code') as x,
                 0 as pri, t.ord
            from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) with ordinality as t(e, ord)
          union all
          select e->>'sourceProductId', e->>'slot',
                 jsonb_build_object('sourceProductId', e->>'sourceProductId', 'slot', e->>'slot',
                                    'sourceUrl', e->>'sourceUrl', 'code', e->>'code'),
                 1, t.ord
            from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) with ordinality as t(e, ord)
        ) q
       order by q.sid, q.slot, q.pri desc, q.ord desc
    ) d;
$$;

-- 把一份已驗證的回報併進匯入紀錄，再重算件數。batch（3 參數）與 finish 共用。
-- 已經寫入成功（created／updated）的商品，其舊的 clientFailure 一併移除：
-- 續傳時，上一段失敗的商品在這一段重試成功，不能同時算成功又算失敗。
-- （一般流程裡，前端失敗的商品不會送進 batch，所以不會有交集；行為與舊版相同。）
create or replace function public._imp_apply_report(p_import_id uuid, p_client_failures jsonb, p_skipped_images jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.product_imports i set
    client_failures = coalesce((
      select jsonb_agg(f order by f->>'sourceProductId')
        from jsonb_array_elements(public._imp_merge_failures(i.client_failures, p_client_failures)) f
       where not exists (select 1 from public.product_import_items t
                          where t.import_id = i.id and t.source_product_id = f->>'sourceProductId'
                            and t.outcome in ('created', 'updated'))), '[]'::jsonb),
    skipped_images = public._imp_merge_skipped(i.skipped_images, p_skipped_images)
  where i.id = p_import_id;
  perform public._imp_refresh(p_import_id);
end $$;

-- ──────────────────────────── 3.6 _imp_record 多四欄 ────────────────────────────
-- externalShopId、files、options、categoryOverrides。既有欄位與型別不變。

create or replace function public._imp_record(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'importId', i.id, 'status', i.status,
    'startedAt', i.started_at, 'finishedAt', i.finished_at,
    'totalProducts', i.total_products,
    'created', i.created_count, 'updated', i.updated_count, 'failed', i.failed_count,
    'skipped', i.skipped,
    'skippedImages', jsonb_array_length(i.skipped_images),
    'externalShopId', i.external_shop_id,
    'files', i.files,
    'options', i.options,
    'categoryOverrides', i.category_overrides)
  from public.product_imports i where i.id = p_import_id;
$$;

-- ──────────────────────────── ① start_product_import（3.3） ────────────────────────────

create or replace function public.start_product_import(p_source text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop  uuid := public._imp_shop();
  v_files jsonb;
  v_kinds text[];
  v_row   public.product_imports%rowtype;
  v_cats  constant text[] := array['women','men','beauty','3c','home','food','sports','baby','games','toys','other'];
  v_co    jsonb := '{}'::jsonb;
begin
  if p_source is distinct from 'shopee' then
    perform public._imp_raise('INVALID_PAYLOAD', '來源必須是 shopee');
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    perform public._imp_raise('INVALID_PAYLOAD', '缺少匯入資訊');
  end if;
  if jsonb_typeof(p_meta->'externalShopId') is distinct from 'string' or btrim(p_meta->>'externalShopId') = ''
     or char_length(p_meta->>'externalShopId') > 40 then
    perform public._imp_raise('INVALID_PAYLOAD', '蝦皮店家 ID 不正確');
  end if;

  v_files := p_meta->'files';
  if jsonb_typeof(v_files) is distinct from 'array' or jsonb_array_length(v_files) <> 3
     or exists (select 1 from jsonb_array_elements(v_files) f
                 where jsonb_typeof(f) <> 'object'
                    or jsonb_typeof(f->'kind') is distinct from 'string'
                    or jsonb_typeof(f->'fileName') is distinct from 'string'
                    or btrim(f->>'fileName') = '') then
    perform public._imp_raise('INVALID_PAYLOAD', '必須恰好有三個檔案（basic_info、sales_info、media_info 各一）');
  end if;
  select array_agg(f->>'kind' order by f->>'kind') into v_kinds from jsonb_array_elements(v_files) f;
  if v_kinds is distinct from array['basic_info', 'media_info', 'sales_info'] then
    perform public._imp_raise('INVALID_PAYLOAD', '必須恰好有三個檔案（basic_info、sales_info、media_info 各一）');
  end if;

  if not public._imp_int_between(p_meta->'totalProducts', 1, 1000000) then
    perform public._imp_raise('INVALID_PAYLOAD', '商品件數必須是 1 以上的整數');
  end if;
  if (p_meta->>'totalProducts')::numeric > 5000 then
    perform public._imp_raise('IMPORT_LIMIT_EXCEEDED', '一次最多匯入 5,000 件商品');
  end if;
  if not public._imp_int_between(p_meta->'skipped', 0, 1000000) then
    perform public._imp_raise('INVALID_PAYLOAD', '略過件數必須是 0 以上的整數');
  end if;
  if jsonb_typeof(p_meta->'options') is distinct from 'object'
     or jsonb_typeof(p_meta#>'{options,skipSoldOut}') is distinct from 'boolean'
     or jsonb_typeof(p_meta#>'{options,allHidden}') is distinct from 'boolean' then
    perform public._imp_raise('INVALID_PAYLOAD', '匯入選項不正確');
  end if;

  -- 選填 categoryOverrides：缺省或 null ＝ {}；有的話必須是物件，key 為 1–20 位數字、value 在 11 個分類內、最多 5,000 個 key
  if p_meta ? 'categoryOverrides' and jsonb_typeof(p_meta->'categoryOverrides') <> 'null' then
    v_co := p_meta->'categoryOverrides';
    if jsonb_typeof(v_co) <> 'object'
       or (select count(*) from jsonb_object_keys(v_co)) > 5000
       or exists (select 1 from jsonb_each(v_co) kv
                   where kv.key !~ '^[0-9]{1,20}$'
                      or jsonb_typeof(kv.value) is distinct from 'string'
                      or not ((kv.value #>> '{}') = any (v_cats))) then
      perform public._imp_raise('INVALID_PAYLOAD', '分類修改不正確');
    end if;
  end if;

  insert into public.product_imports (shop_id, source, external_shop_id, files, options, total_products, skipped,
                                      category_overrides)
  values (v_shop, 'shopee', btrim(p_meta->>'externalShopId'),
          (select jsonb_agg(jsonb_build_object('kind', f->>'kind', 'fileName', f->>'fileName'))
             from jsonb_array_elements(v_files) f),
          jsonb_build_object('skipSoldOut', (p_meta#>>'{options,skipSoldOut}')::boolean,
                             'allHidden', (p_meta#>>'{options,allHidden}')::boolean),
          (p_meta->>'totalProducts')::numeric::integer, (p_meta->>'skipped')::numeric::integer,
          v_co)
  returning * into v_row;

  return jsonb_build_object('importId', v_row.id, 'startedAt', v_row.started_at);
end $$;

-- ──────────────────────────── ② import_products_batch（3.4） ────────────────────────────
-- 新 overload（3 參數）：原 2 參數版的全部行為，加上把這一批的前端回報併進匯入紀錄。
-- p_report = { clientFailures: [...], skippedImages: [...] }，冪等：同一份送兩次結果相同。

create or replace function public.import_products_batch(p_import_id text, p_items jsonb, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop    uuid := public._imp_shop();
  v_id      uuid;
  v_imp     public.product_imports%rowtype;
  v_n       integer;
  v_distinct integer;
  v_dup     boolean[];
  v_seen    text[] := array[]::text[];
  v_sid     text;
  v_item    jsonb;
  v_idx     integer;
  v_res     jsonb;
  v_results jsonb[];
  v_err     jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    perform public._imp_raise('INVALID_PAYLOAD', 'items 必須是物件陣列');
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 or v_n > 100 then
    perform public._imp_raise('BATCH_TOO_LARGE', '每次呼叫必須有 1–100 件商品');
  end if;

  if p_report is null or jsonb_typeof(p_report) <> 'object'
     or jsonb_typeof(p_report->'clientFailures') is distinct from 'array'
     or jsonb_typeof(p_report->'skippedImages') is distinct from 'array' then
    perform public._imp_raise('INVALID_PAYLOAD', 'report 格式不正確（需含 clientFailures 與 skippedImages 兩個陣列）');
  end if;
  perform public._imp_check_report(p_report->'clientFailures', p_report->'skippedImages');

  begin
    v_id := p_import_id::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  -- 鎖住這筆匯入紀錄：同一個匯入的批次依序進行
  select * into v_imp from public.product_imports where id = v_id and shop_id = v_shop for update;
  if not found then
    perform public._imp_raise('IMPORT_NOT_FOUND', '找不到這筆匯入');
  end if;
  if v_imp.status <> 'running' then
    perform public._imp_raise('IMPORT_CLOSED', '這筆匯入已結束，不能再寫入');
  end if;

  -- 此匯入累計的不同來源商品 ID 不可超過 totalProducts
  select count(*) into v_distinct from (
    select source_product_id from public.product_import_items where import_id = v_imp.id
    union
    select e->>'sourceProductId' from jsonb_array_elements(p_items) e
     where jsonb_typeof(e->'sourceProductId') = 'string'
  ) u;
  if v_distinct > v_imp.total_products then
    perform public._imp_raise('IMPORT_LIMIT_EXCEEDED',
      format('這次匯入累計的商品超過預計的 %s 件', v_imp.total_products));
  end if;

  -- 同一次呼叫內的重複：依輸入順序，第二個起算重複
  v_dup := array_fill(false, array[v_n]);
  v_results := array_fill(null::jsonb, array[v_n]);
  for v_pos in 1 .. v_n loop
    v_item := p_items -> (v_pos - 1);
    if jsonb_typeof(v_item->'sourceProductId') = 'string' then
      v_sid := v_item->>'sourceProductId';
      if v_sid = any (v_seen) then
        v_dup[v_pos] := true;
      else
        v_seen := v_seen || v_sid;
      end if;
    end if;
  end loop;

  -- 依來源商品 ID 排序處理：不同的匯入同時寫同一批商品時，取鎖順序一致，避免死結。
  -- 結果仍依輸入順序放回 results[]。
  for v_idx in
    select o.i from (
      select i, coalesce(p_items->(i - 1)->>'sourceProductId', '') as k, i as pos
        from generate_series(1, v_n) i
    ) o order by o.k, o.pos
  loop
    v_item := p_items -> (v_idx - 1);
    v_sid := case when jsonb_typeof(v_item->'sourceProductId') = 'string' then v_item->>'sourceProductId' else '' end;

    if v_dup[v_idx] then
      v_results[v_idx] := jsonb_build_object('sourceProductId', v_sid, 'outcome', 'failed',
        'productId', null, 'status', null,
        'errors', jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_IN_BATCH',
          'field', 'sourceProductId', 'message', '同一次呼叫內商品 ID 重複')));
      continue;
    end if;

    begin
      v_res := public._imp_process_item(v_shop, v_item);
    exception when others then
      -- 單件原子：這件的寫入整件回復，其他件不受影響
      v_res := jsonb_build_object('sourceProductId', v_sid, 'outcome', 'failed', 'productId', null, 'status', null,
        'errors', jsonb_build_array(jsonb_build_object('code', 'INTERNAL', 'field', '', 'message', SQLERRM)));
    end;
    v_results[v_idx] := v_res;

    if v_sid ~ '^[0-9]{1,20}$' then
      v_err := v_res->'errors'->0;
      -- created 不會被後續的 updated 蓋掉；已成功的不會被失敗蓋掉；失敗後重送成功則改為成功
      insert into public.product_import_items as t (import_id, source_product_id, outcome, product_id, error_code, error_message)
      values (v_imp.id, v_sid, v_res->>'outcome', (v_res->>'productId')::uuid,
              v_err->>'code', v_err->>'message')
      on conflict (import_id, source_product_id) do update set
        outcome = case
                    when t.outcome = 'created' and excluded.outcome <> 'failed' then 'created'
                    when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.outcome
                    else excluded.outcome end,
        product_id = coalesce(excluded.product_id, t.product_id),
        error_code = case when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.error_code
                          else excluded.error_code end,
        error_message = case when t.outcome <> 'failed' and excluded.outcome = 'failed' then t.error_message
                             else excluded.error_message end,
        updated_at = now();
    end if;
  end loop;

  -- 併入前端回報（去重）並重算件數
  perform public._imp_apply_report(v_imp.id, p_report->'clientFailures', p_report->'skippedImages');

  return jsonb_build_object('importId', v_imp.id, 'results', to_jsonb(v_results));
end $$;

-- 舊 2 參數版：保留（舊前端還在用），改成呼叫 3 參數版並傳空回報。簽名、權限、回傳、錯誤碼都與之前相同。
create or replace function public.import_products_batch(p_import_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.import_products_batch(p_import_id, p_items, '{"clientFailures":[],"skippedImages":[]}'::jsonb);
end $$;

-- ──────────────────────────── ③ finish_product_import（3.5：改為合併） ────────────────────────────

create or replace function public.finish_product_import(p_import_id text, p_client_failures jsonb, p_skipped_images jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._imp_shop();
  v_id   uuid;
  v_imp  public.product_imports%rowtype;
begin
  perform public._imp_check_report(p_client_failures, p_skipped_images);

  begin
    v_id := p_import_id::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  select * into v_imp from public.product_imports where id = v_id and shop_id = v_shop for update;
  if not found then
    perform public._imp_raise('IMPORT_NOT_FOUND', '找不到這筆匯入');
  end if;
  if v_imp.status <> 'running' then
    perform public._imp_raise('IMPORT_CLOSED', '這筆匯入已結束');
  end if;

  -- 合併（不覆蓋）：續傳的新分頁只送自己這段的失敗，之前批次已存的保留
  perform public._imp_apply_report(v_imp.id, p_client_failures, p_skipped_images);

  -- 失敗清單：資料庫端失敗的件（商品 ID＋原因代碼）＋前端回報的件；同一件商品只列一次
  update public.product_imports i set
    status = 'completed', finished_at = now(),
    failures = coalesce((
      select jsonb_agg(x order by x->>'sourceProductId') from (
        select distinct on (sid) sid, x from (
          select t.source_product_id as sid,
                 jsonb_build_object('sourceProductId', t.source_product_id, 'code', t.error_code,
                                    'message', t.error_message, 'origin', 'server') as x, 0 as pri
            from public.product_import_items t where t.import_id = i.id and t.outcome = 'failed'
          union all
          select f->>'sourceProductId',
                 jsonb_build_object('sourceProductId', f->>'sourceProductId', 'code', f->>'code',
                                    'message', f->>'message', 'origin', 'client'), 1
            from jsonb_array_elements(i.client_failures) f
        ) q order by sid, pri
      ) d(sid, x)), '[]'::jsonb)
  where i.id = v_imp.id;

  return public._imp_record(v_imp.id);
end $$;

-- ──────────────────────────── ④ get_import_index（3.7：running 帶 progress） ────────────────────────────

create or replace function public.get_import_index(p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._imp_shop();
  v_last uuid;
  v_rec  jsonb;
begin
  if p_source is distinct from 'shopee' then
    perform public._imp_raise('INVALID_PAYLOAD', '來源必須是 shopee');
  end if;

  select id into v_last from public.product_imports
   where shop_id = v_shop and source = p_source order by started_at desc limit 1;

  if v_last is not null then
    v_rec := public._imp_record(v_last);
    -- 進行中：附上續傳需要的進度；已完成：progress 為 null（不送沒人用的 5,000 筆）
    v_rec := v_rec || jsonb_build_object('progress',
      case when v_rec->>'status' = 'running' then (
        select jsonb_build_object(
                 'items', coalesce((select jsonb_agg(jsonb_build_object('sourceProductId', t.source_product_id,
                                                                        'outcome', t.outcome)
                                                     order by t.source_product_id)
                                      from public.product_import_items t where t.import_id = v_last), '[]'::jsonb),
                 'clientFailures', i.client_failures,
                 'skippedImages', i.skipped_images)
          from public.product_imports i where i.id = v_last)
      else null end);
  end if;

  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sourceProductId', p.source_product_id, 'productId', p.id, 'status', p.status,
               'variants', coalesce((
                  select jsonb_agg(jsonb_build_object('sourceVariantId', v->>'sourceId', 'variantId', v->>'id'))
                    from jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) v
                   where v->>'sourceId' is not null), '[]'::jsonb))
             order by p.source_product_id)
        from public.products p where p.shop_id = v_shop and p.source = p_source), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('sourceUrl', m.source_url, 'url', m.url) order by m.source_url)
        from public.product_import_images m where m.shop_id = v_shop and m.source = p_source), '[]'::jsonb),
    'lastImport', v_rec);
end $$;

-- ──────────────────────────── 函式權限 ────────────────────────────
-- 新的內部工具函式一律收回；新 overload 比照其他對外函式（anon 要能收到 NOT_AUTHENTICATED）。
-- 既有函式 create or replace 不會動到權限，這裡不重複處理。

revoke all on function public._imp_check_report(jsonb, jsonb)            from public, anon, authenticated;
revoke all on function public._imp_merge_failures(jsonb, jsonb)          from public, anon, authenticated;
revoke all on function public._imp_merge_skipped(jsonb, jsonb)           from public, anon, authenticated;
revoke all on function public._imp_apply_report(uuid, jsonb, jsonb)      from public, anon, authenticated;

revoke all on function public.import_products_batch(text, jsonb, jsonb)  from public;
grant execute on function public.import_products_batch(text, jsonb, jsonb) to anon, authenticated;
