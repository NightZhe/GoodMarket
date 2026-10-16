-- 商品評價（spec v0.2 第 8 節；decisions.md D1–D13）
--
-- 只新增或收緊權限，不改任何既有資料：
--   · 新增 4 張表、1 個 Storage bucket、一組函式
--   · 收緊 orders 的欄位權限（8.6，D10）：authenticated 讀不到 access_token，只能改 status／carrier／tracking_no
--   · 不碰 products／shops 的資料與 rating 欄位，不改任何既有 RPC 的簽名與回傳
--
-- 錯誤格式沿用蝦皮匯入：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）
-- 所有 RPC 的 JSON 輸出一律 snake_case；p_items 的輸入欄位依規格用 camelCase（productId）。
--
-- 套用方式見 CLAUDE.md：本機 supabase db reset --local；正式站 db query --linked -f（要等使用者確認）。

-- ──────────────────────────── 設定 ────────────────────────────
-- 單列設定表。legacy_completed_at＝本 migration 的套用時間：
-- 已完成、但 events 裡沒有 completed 事件的舊訂單（R-3），以此當作完成時間。
-- 重跑 migration 不會覆蓋（on conflict do nothing），所以舊訂單的期限不會被順延。
create table if not exists public.review_settings (
  id                  boolean primary key default true check (id),
  legacy_completed_at timestamptz not null default now()
);
insert into public.review_settings (id) values (true) on conflict (id) do nothing;

-- ──────────────────────────── 8.1 資料表 ────────────────────────────

create table if not exists public.product_reviews (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  shop_id           uuid not null references public.shops(id) on delete cascade,
  -- 不設外鍵：商品被刪除後評價保留（R-15）
  product_id        uuid not null,
  -- 下單當下的快照（來自 orders.lines）
  product_title     text not null,
  product_image     text not null default '',
  variant_names     text[] not null default '{}',
  rating            smallint not null check (rating between 1 and 5),
  content           text not null default '' check (char_length(content) <= 500),
  -- 原始暱稱：公開 RPC 永遠不回傳這個欄位（R-7）
  reviewer_nickname text check (reviewer_nickname is null or char_length(reviewer_nickname) between 2 and 12),
  seller_reply      text check (seller_reply is null or char_length(seller_reply) between 1 and 500),
  seller_replied_at timestamptz,
  hidden_at         timestamptz,
  created_at        timestamptz not null default now(),
  constraint product_reviews_order_product_key unique (order_id, product_id),
  constraint product_reviews_reply_pair check ((seller_reply is null) = (seller_replied_at is null))
);
create index if not exists product_reviews_product_idx on public.product_reviews (product_id, created_at desc, id desc);
create index if not exists product_reviews_shop_idx    on public.product_reviews (shop_id, created_at desc, id desc);

create table if not exists public.review_photos (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.product_reviews(id) on delete cascade,
  -- bucket review-images 內的路徑，完全隨機（R-18）
  path       text not null unique,
  position   smallint not null check (position between 0 and 4),
  -- 平台移除的時間：有值就不顯示，等清理腳本刪除實體檔
  removed_at timestamptz,
  constraint review_photos_review_position_key unique (review_id, position)
);

create table if not exists public.review_upload_slots (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null,
  path       text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_upload_slots_order_product_idx on public.review_upload_slots (order_id, product_id);

-- 不建任何 policy：RLS 開著＝anon／authenticated 一律讀寫不到；再把表權限也收回，
-- 被擋時會直接得到 permission denied，而不是靜默回空。全部經過下面的 SECURITY DEFINER 函式。
alter table public.review_settings     enable row level security;
alter table public.product_reviews     enable row level security;
alter table public.review_photos       enable row level security;
alter table public.review_upload_slots enable row level security;
revoke all on public.review_settings, public.product_reviews, public.review_photos, public.review_upload_slots
  from public, anon, authenticated;

-- ──────────────────────────── 內部工具函式（不開放給前端） ────────────────────────────

-- 標 stable 只是為了讓 stable 的讀取型 RPC（get_*）能呼叫它而不被 lint 警告；它只做一件事：丟錯誤
create or replace function public._rv_raise(p_code text, p_message text)
returns void language plpgsql stable set search_path = public as $$
begin
  raise exception '%', p_message using hint = p_code;
end $$;

-- 去掉頭尾空白（含全形空白、不換行空白）
create or replace function public._rv_trim(p text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(p, '^[\s 　]+|[\s 　]+$', '', 'g');
$$;

-- R-7 遮罩：3 字以上＝首字＋*****＋末字；2 字＝首字＋*****；沒有＝匿名買家。一律 5 顆星，藏住實際長度。
create or replace function public._rv_mask(p_nick text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_nick is null or char_length(p_nick) < 2 then '匿名買家'
    when char_length(p_nick) = 2                   then left(p_nick, 1) || '*****'
    else left(p_nick, 1) || '*****' || right(p_nick, 1)
  end;
$$;

-- R-7 暱稱：去頭尾空白 → 空字串視為沒填（回 null）→ 2–12 個字（code point）→ 字元只能是：
--   · 漢字（中文）：U+3400–4DBF（擴充 A）、U+4E00–9FFF、U+F900–FAFF（相容漢字）、U+20000–2FA1F 與 U+30000–323AF（擴充 B–H）
--   · 英文字母 A–Z a–z、阿拉伯數字 0–9、底線 _、連字號 -
-- 明確的 code point 區段，不用 [[:alnum:]]／\w，所以不依賴資料庫 locale，本機與正式站結果一致。
-- 日文假名、韓文、帶重音的拉丁字母、其他文字，以及全形英數、羅馬數字（Ⅻ）、帶圈數字（①）、分數（½）、
-- CJK 符號與標點（・ 、 。 々 〇）、emoji、空白、其他標點符號（. ! @ 等，順便擋掉網址與 email）都不允許。
-- 理由：R-7 與錯誤訊息的字面是「中英文、數字、_ 和 -」；日韓文字不在這個字面範圍內，
-- 而「只收明確列舉的字元」讓前後端能用同一份規則與測試向量（nickname-vectors.json）對齊。
create or replace function public._rv_nickname(p_nick text)
returns text language plpgsql stable set search_path = public as $$
declare
  v text;
begin
  if p_nick is null then return null; end if;
  v := public._rv_trim(p_nick);
  if v = '' then return null; end if;
  if char_length(v) not between 2 and 12
     or v !~ '^[-_0-9A-Za-z㐀-䶿一-鿿豈-﫿\U00020000-\U0002fa1f\U00030000-\U000323af]+$' then
    perform public._rv_raise('NICKNAME_INVALID', '暱稱需為 2 到 12 個字，只能用中英文、數字、_ 和 -');
  end if;
  return v;
end $$;

-- 訂單完成時間（R-3）：events 裡最後一筆 completed 事件的 at；沒有就用 migration 套用時間
create or replace function public._rv_completed_at(p_events jsonb)
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(
    (select (e.value->>'at')::timestamptz
       from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end)
            with ordinality as e(value, ord)
      where e.value->>'status' = 'completed' and e.value->>'at' ~ '^\d{4}-\d{2}-\d{2}[T ]'
      order by e.ord desc limit 1),
    (select legacy_completed_at from public.review_settings)
  );
$$;

-- 期限那一天（台北時間，完成日 + 30 天）
create or replace function public._rv_deadline_date(p_completed timestamptz)
returns date language sql stable set search_path = public as $$
  select (p_completed at time zone 'Asia/Taipei')::date + 30;
$$;

-- 期限那天的 23:59:59（台北時間），顯示用
create or replace function public._rv_deadline_at(p_completed timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((public._rv_deadline_date(p_completed) + 1)::timestamp at time zone 'Asia/Taipei') - interval '1 second';
$$;

-- 是否已過期：台北時間期限那天結束（隔天 00:00:00）起算
create or replace function public._rv_expired(p_completed timestamptz, p_now timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_now >= ((public._rv_deadline_date(p_completed) + 1)::timestamp at time zone 'Asia/Taipei');
$$;

-- R-1 的 1～3 點：憑證對得上、已完成、沒過期。順便鎖住訂單那一列，
-- 讓同一張訂單的兩個同時請求排隊（連點送出、累計上限都靠這個）。
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
  if v.status <> 'completed' then
    perform public._rv_raise('ORDER_NOT_COMPLETED', '訂單完成後才能評價');
  end if;
  if public._rv_expired(public._rv_completed_at(v.events), now()) then
    perform public._rv_raise('REVIEW_EXPIRED', '評價期限已過');
  end if;
  return v;
end $$;

-- 商品在訂單 lines 裡的快照；不在訂單裡回 null。同一商品多個規格合併（D11）。
create or replace function public._rv_snapshot(p_lines jsonb, p_product uuid)
returns jsonb language sql stable set search_path = public as $$
  with ls as (
    select t.value as l, t.ord from jsonb_array_elements(p_lines) with ordinality as t(value, ord)
     where t.value->>'productId' = p_product::text
  )
  select case when not exists (select 1 from ls) then null else jsonb_build_object(
    'title', (select l->>'title' from ls order by ord limit 1),
    'image', coalesce((select l->>'image' from ls order by ord limit 1), ''),
    'variant_names', coalesce((
      select jsonb_agg(v.vn order by v.o)
        from (select l->>'variantName' as vn, min(ord) as o from ls
               where coalesce(l->>'variantName', '') <> '' group by 1) v), '[]'::jsonb)
  ) end;
$$;

-- 店主的店 id：未登入 → NOT_AUTHENTICATED；沒有店 → NO_SHOP
create or replace function public._rv_shop()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_shop uuid;
begin
  if v_uid is null then
    perform public._rv_raise('NOT_AUTHENTICATED', '請先登入');
  end if;
  select s.id into v_shop from public.shops s where s.owner_id = v_uid;
  if v_shop is null then
    perform public._rv_raise('NO_SHOP', '你還沒有開店');
  end if;
  return v_shop;
end $$;

-- 公開評價列表（商品或賣場）。回傳的每則評價只有遮罩後的 display_name，沒有原始暱稱、訂單編號、訂單 id。
-- counts／total／with_photos 不受目前篩選影響（篩選鈕上的數字）；filtered_total 是套用篩選後的總數（載入更多用）。
create or replace function public._rv_public_list(
  p_product uuid, p_shop uuid, p_rating integer, p_with_photos boolean,
  p_limit integer, p_offset integer, p_with_product boolean
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_rating is not null and p_rating not between 1 and 5 then
    perform public._rv_raise('RATING_INVALID', '請選擇 1 到 5 顆星');
  end if;
  return (
    with base as (
      select r.*, exists (select 1 from public.review_photos ph where ph.review_id = r.id and ph.removed_at is null) as has_photo
        from public.product_reviews r
       where r.hidden_at is null
         and (p_product is null or r.product_id = p_product)
         and (p_shop is null or r.shop_id = p_shop)
    ), filtered as (
      select * from base
       where (p_rating is null or rating = p_rating) and (not coalesce(p_with_photos, false) or has_photo)
    ), page as (
      select * from filtered order by created_at desc, id desc limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total',          (select count(*) from base),
      'with_photos',    (select count(*) from base where has_photo),
      'counts',         (select jsonb_build_object(
                           '1', count(*) filter (where rating = 1), '2', count(*) filter (where rating = 2),
                           '3', count(*) filter (where rating = 3), '4', count(*) filter (where rating = 4),
                           '5', count(*) filter (where rating = 5)) from base),
      'filtered_total', (select count(*) from filtered),
      -- 商品範圍的查詢才有：商品名稱與圖片用評價裡存的快照，不讀 products（匿名看不到下架的商品，商品被刪除後也沒有列）；
      -- available＝商品目前仍上架。這個商品沒有任何評價時為 null。
      'product',        case when p_product is null then null else (
                          select jsonb_build_object('id', r.product_id, 'shop_id', r.shop_id, 'title', r.product_title, 'image', r.product_image,
                                   'available', exists (select 1 from public.products pr where pr.id = r.product_id and pr.status = 'active'))
                            from public.product_reviews r where r.product_id = p_product
                           order by r.created_at desc, r.id desc limit 1) end,
      'reviews',        coalesce((select jsonb_agg(
          jsonb_build_object(
            'id', p.id, 'rating', p.rating,
            'display_name', public._rv_mask(p.reviewer_nickname),
            'variant_names', to_jsonb(p.variant_names),
            'content', p.content, 'created_at', p.created_at,
            'seller_reply', p.seller_reply, 'seller_replied_at', p.seller_replied_at,
            'photos', coalesce((select jsonb_agg(ph.path order by ph.position)
                                  from public.review_photos ph where ph.review_id = p.id and ph.removed_at is null), '[]'::jsonb)
          ) || case when p_with_product then jsonb_build_object(
            'product_id', p.product_id, 'product_title', p.product_title, 'product_image', p.product_image,
            'product_available', exists (select 1 from public.products pr where pr.id = p.product_id and pr.status = 'active')
          ) else '{}'::jsonb end
          order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
    )
  );
end $$;

-- Storage 上傳權限檢查：這個路徑是不是「存在、還沒過期、還沒被使用」的上傳位置。
-- SECURITY DEFINER，所以 anon 不需要讀 review_upload_slots。
create or replace function public._rv_slot_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.review_upload_slots s
     where s.path = p_path and s.used_at is null and s.expires_at > now()
  );
$$;

-- ──────────────────────────── 8.4 買家端 RPC ────────────────────────────

-- 買家查自己的評價狀態。p_keys＝[{id, token}]（跟 get_my_orders 同一組憑證）。
-- 只回「已完成」而且憑證對得上的訂單；憑證不對的靜默略過。
-- 回傳 jsonb 陣列（新的訂單在前）：
--   { order_id, order_no, completed_at, deadline_date('YYYY-MM-DD'), deadline_at, expired,
--     items: [{ product_id, title, image, variant_names[], reviewed,
--               review: null | { id, rating, content, nickname(原始，只有買家本人看得到), created_at,
--                                photos[], seller_reply, seller_replied_at, hidden } }] }
create or replace function public.get_my_review_status(p_keys jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'order_no', o.order_no,
        'completed_at', c.at,
        'deadline_date', to_char(public._rv_deadline_date(c.at), 'YYYY-MM-DD'),
        'deadline_at', public._rv_deadline_at(c.at),
        'expired', public._rv_expired(c.at, v_now),
        'items', it.items
      ) order by o.created_at desc, o.id)
    from (select distinct k.value as k from jsonb_array_elements(p_keys) as k(value)) keys
    join public.orders o
      on o.id = case when keys.k->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then (keys.k->>'id')::uuid end
     and o.access_token = keys.k->>'token'
     and o.status = 'completed'
    cross join lateral (select public._rv_completed_at(o.events) as at) c
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
        select x.pid, public._rv_snapshot(o.lines, x.pid) as snap, x.first_ord
          from (select (t.value->>'productId')::uuid as pid, min(t.ord) as first_ord
                  from jsonb_array_elements(o.lines) with ordinality as t(value, ord)
                 where t.value->>'productId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 group by 1) x
      ) g
      left join public.product_reviews r on r.order_id = o.id and r.product_id = g.pid
    ) it
  ), '[]'::jsonb);
end $$;

-- 申請照片上傳位置（R-18、R-19）。回傳 jsonb 陣列 [{ path, expires_at }]，長度 = p_count。
create or replace function public.request_review_upload(p_order_id uuid, p_token text, p_product_id uuid, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order   public.orders;
  v_expires timestamptz := now() + interval '30 minutes';
  v_out     jsonb;
begin
  v_order := public._rv_load_order(p_order_id, p_token);
  if public._rv_snapshot(v_order.lines, p_product_id) is null then
    perform public._rv_raise('PRODUCT_NOT_IN_ORDER', '資料有誤，請重新整理');
  end if;
  if exists (select 1 from public.product_reviews r where r.order_id = p_order_id and r.product_id = p_product_id) then
    perform public._rv_raise('ALREADY_REVIEWED', '這件商品已經評價過了');
  end if;
  if p_count is null or p_count not between 1 and 5 then
    perform public._rv_raise('UPLOAD_COUNT_INVALID', '每則評價最多 5 張照片');
  end if;
  if (select count(*) from public.review_upload_slots s
       where s.order_id = p_order_id and s.product_id = p_product_id) + p_count > 15 then
    perform public._rv_raise('UPLOAD_LIMIT_EXCEEDED', '照片上傳次數已達上限');
  end if;

  with ins as (
    insert into public.review_upload_slots (order_id, product_id, path, expires_at)
    select p_order_id, p_product_id, gen_random_uuid()::text || '.jpg', v_expires
      from generate_series(1, p_count)
    returning path, expires_at
  )
  select jsonb_agg(jsonb_build_object('path', ins.path, 'expires_at', ins.expires_at)) into v_out from ins;
  return v_out;
end $$;

-- 送出評價（R-1、R-4、R-5、R-7、R-17、R-18）。全有全無：任何一件不合格就 raise，整個交易回滾。
-- p_items = [{ productId, rating, content, photos: [path…] }]（content、photos 可省略）
-- 星等只收 JSON 數字且為 1–5 的整數；字串 "5" 一律 RATING_INVALID。
-- 回傳 jsonb 陣列 [{ id, product_id }]。
create or replace function public.submit_reviews(p_order_id uuid, p_token text, p_nickname text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order   public.orders;
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
  v_order := public._rv_load_order(p_order_id, p_token);

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

    v_snap := public._rv_snapshot(v_order.lines, v_pid);
    if v_snap is null then
      perform public._rv_raise('PRODUCT_NOT_IN_ORDER', '資料有誤，請重新整理');
    end if;
    if exists (select 1 from public.product_reviews r where r.order_id = p_order_id and r.product_id = v_pid) then
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
      (p_order_id, v_order.shop_id, v_pid, v_snap->>'title', v_snap->>'image',
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
        where s.path = (v_ph #>> '{}') and s.order_id = p_order_id and s.product_id = v_pid
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

-- ──────────────────────────── 8.4 公開 RPC ────────────────────────────

-- 全站統計，一次回傳。只算未隱藏的評價；avg 四捨五入到小數第 1 位（.05 進位，numeric 的 round）。
-- { products: { "<product_id>": {count, avg} }, shops: { "<shop_id>": {count, avg} } }；沒有評價的不出現。
create or replace function public.get_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'products', coalesce((select jsonb_object_agg(t.product_id::text, jsonb_build_object('count', t.c, 'avg', t.a))
                            from (select product_id, count(*) as c, round(avg(rating), 1) as a
                                    from public.product_reviews where hidden_at is null group by product_id) t), '{}'::jsonb),
    'shops',    coalesce((select jsonb_object_agg(t.shop_id::text, jsonb_build_object('count', t.c, 'avg', t.a))
                            from (select shop_id, count(*) as c, round(avg(rating), 1) as a
                                    from public.product_reviews where hidden_at is null group by shop_id) t), '{}'::jsonb)
  );
$$;

-- { total, with_photos, counts: {"1".."5"}（以上三項不受篩選影響）, filtered_total（套用 p_rating／p_with_photos 後的總數，「符合條件 n 則」與載入更多用）,
--   product: { id, shop_id, title, image（快照）, available } | null（shop_id 取自評價，商品下架或刪除後匿名讀不到 products 也拿得到店 id）,
--   reviews: [{ id, rating, display_name, variant_names[], content, created_at, seller_reply, seller_replied_at, photos[] }] }
create or replace function public.get_product_reviews(
  p_product_id uuid, p_rating integer default null, p_with_photos boolean default false,
  p_limit integer default 20, p_offset integer default 0
) returns jsonb language sql stable security definer set search_path = public as $$
  select public._rv_public_list(p_product_id, null, p_rating, p_with_photos, p_limit, p_offset, false);
$$;

-- 同上，每則評價多：product_id、product_title、product_image（下單快照）、product_available（商品還在架上）
create or replace function public.get_shop_reviews(
  p_shop_id uuid, p_rating integer default null, p_with_photos boolean default false,
  p_limit integer default 20, p_offset integer default 0
) returns jsonb language sql stable security definer set search_path = public as $$
  select public._rv_public_list(null, p_shop_id, p_rating, p_with_photos, p_limit, p_offset, true);
$$;

-- ──────────────────────────── 8.4 賣家端 RPC ────────────────────────────

-- { unreplied_count（未回覆、未隱藏）, review_count（未隱藏）, rating（跟公開的賣場評分相同；沒有評價為 null） }
create or replace function public.get_seller_review_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_shop uuid := public._rv_shop();
begin
  return (
    select jsonb_build_object(
      'unreplied_count', count(*) filter (where seller_reply is null),
      'review_count',    count(*),
      'rating',          round(avg(rating), 1))
      from public.product_reviews where shop_id = v_shop and hidden_at is null
  );
end $$;

-- p_tab：'all'（全部，含被隱藏的）或 'unreplied'（未回覆而且未隱藏）。
-- { tab, counts: {"all","1".."5"}（跟著 tab 算，不受 p_rating 影響）, total（套用 p_rating 後）,
--   reviews: [{ id, rating, display_name（完整暱稱，D13；沒填＝匿名買家）, order_no（D8）, variant_names[],
--               product_id, product_title, product_image, product_available, content, created_at,
--               photos[], seller_reply, seller_replied_at, hidden }] }
-- 不含買家的姓名、電話、地址、access_token、訂單 id。
create or replace function public.get_seller_reviews(
  p_tab text default 'all', p_rating integer default null, p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_shop   uuid := public._rv_shop();
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_tab is null or p_tab not in ('all', 'unreplied') then
    perform public._rv_raise('TAB_INVALID', '分頁不正確');
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    perform public._rv_raise('RATING_INVALID', '請選擇 1 到 5 顆星');
  end if;
  return (
    with base as (
      select r.* from public.product_reviews r
       where r.shop_id = v_shop and (p_tab = 'all' or (r.seller_reply is null and r.hidden_at is null))
    ), filtered as (
      select * from base where p_rating is null or rating = p_rating
    ), page as (
      select * from filtered order by created_at desc, id desc limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'tab', p_tab,
      'counts', (select jsonb_build_object(
                   'all', count(*),
                   '1', count(*) filter (where rating = 1), '2', count(*) filter (where rating = 2),
                   '3', count(*) filter (where rating = 3), '4', count(*) filter (where rating = 4),
                   '5', count(*) filter (where rating = 5)) from base),
      'total', (select count(*) from filtered),
      'reviews', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'rating', p.rating,
          'display_name', coalesce(p.reviewer_nickname, '匿名買家'),
          'order_no', o.order_no,
          'variant_names', to_jsonb(p.variant_names),
          'product_id', p.product_id, 'product_title', p.product_title, 'product_image', p.product_image,
          'product_available', exists (select 1 from public.products pr where pr.id = p.product_id and pr.status = 'active'),
          'content', p.content, 'created_at', p.created_at,
          'photos', coalesce((select jsonb_agg(ph.path order by ph.position)
                                from public.review_photos ph where ph.review_id = p.id and ph.removed_at is null), '[]'::jsonb),
          'seller_reply', p.seller_reply, 'seller_replied_at', p.seller_replied_at,
          'hidden', p.hidden_at is not null
        ) order by p.created_at desc, p.id desc)
        from page p join public.orders o on o.id = p.order_id), '[]'::jsonb)
    )
  );
end $$;

-- 新增或覆蓋回覆（R-12）。回傳 { id, seller_reply, seller_replied_at }。
create or replace function public.reply_review(p_review_id uuid, p_reply text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop  uuid := public._rv_shop();
  v_r     public.product_reviews;
  v_reply text;
begin
  select * into v_r from public.product_reviews r where r.id = p_review_id and r.shop_id = v_shop for update;
  if not found then
    perform public._rv_raise('REVIEW_NOT_FOUND', '找不到這則評價');
  end if;
  if v_r.hidden_at is not null then
    perform public._rv_raise('REVIEW_HIDDEN', '這則評價已被平台隱藏');
  end if;
  v_reply := public._rv_trim(p_reply);
  if v_reply is null or char_length(v_reply) not between 1 and 500 then
    perform public._rv_raise('REPLY_INVALID', '回覆需為 1 到 500 字');
  end if;
  update public.product_reviews set seller_reply = v_reply, seller_replied_at = now()
    where id = v_r.id returning seller_replied_at into v_r.seller_replied_at;
  return jsonb_build_object('id', v_r.id, 'seller_reply', v_reply, 'seller_replied_at', v_r.seller_replied_at);
end $$;

-- ──────────────────────────── 函式權限 ────────────────────────────
-- 預設權限會把新函式開給 anon／authenticated：內部工具函式全部收回。
-- _rv_slot_open 例外：Storage 的 policy 以呼叫者身分執行，需要 EXECUTE；它只回「這個路徑是不是開著的上傳位置」，
-- 路徑是隨機 uuid，無法列舉。

revoke all on function public._rv_raise(text, text)                       from public, anon, authenticated;
revoke all on function public._rv_trim(text)                              from public, anon, authenticated;
revoke all on function public._rv_mask(text)                              from public, anon, authenticated;
revoke all on function public._rv_nickname(text)                          from public, anon, authenticated;
revoke all on function public._rv_completed_at(jsonb)                     from public, anon, authenticated;
revoke all on function public._rv_deadline_date(timestamptz)              from public, anon, authenticated;
revoke all on function public._rv_deadline_at(timestamptz)                from public, anon, authenticated;
revoke all on function public._rv_expired(timestamptz, timestamptz)       from public, anon, authenticated;
revoke all on function public._rv_load_order(uuid, text)                  from public, anon, authenticated;
revoke all on function public._rv_snapshot(jsonb, uuid)                   from public, anon, authenticated;
revoke all on function public._rv_shop()                                  from public, anon, authenticated;
revoke all on function public._rv_public_list(uuid, uuid, integer, boolean, integer, integer, boolean)
                                                                          from public, anon, authenticated;
revoke all on function public._rv_slot_open(text)                         from public;
grant execute on function public._rv_slot_open(text)                      to anon, authenticated;

revoke all on function public.get_my_review_status(jsonb)                              from public;
revoke all on function public.request_review_upload(uuid, text, uuid, integer)         from public;
revoke all on function public.submit_reviews(uuid, text, text, jsonb)                  from public;
revoke all on function public.get_review_summary()                                    from public;
revoke all on function public.get_product_reviews(uuid, integer, boolean, integer, integer) from public;
revoke all on function public.get_shop_reviews(uuid, integer, boolean, integer, integer)    from public;
revoke all on function public.get_seller_review_counts()                               from public;
revoke all on function public.get_seller_reviews(text, integer, integer, integer)      from public;
revoke all on function public.reply_review(uuid, text)                                 from public;
-- 賣家端 RPC 也開給 anon：未登入呼叫時要回 NOT_AUTHENTICATED，而不是 permission denied
grant execute on function public.get_my_review_status(jsonb)                              to anon, authenticated;
grant execute on function public.request_review_upload(uuid, text, uuid, integer)         to anon, authenticated;
grant execute on function public.submit_reviews(uuid, text, text, jsonb)                  to anon, authenticated;
grant execute on function public.get_review_summary()                                    to anon, authenticated;
grant execute on function public.get_product_reviews(uuid, integer, boolean, integer, integer) to anon, authenticated;
grant execute on function public.get_shop_reviews(uuid, integer, boolean, integer, integer)    to anon, authenticated;
grant execute on function public.get_seller_review_counts()                               to anon, authenticated;
grant execute on function public.get_seller_reviews(text, integer, integer, integer)      to anon, authenticated;
grant execute on function public.reply_review(uuid, text)                                 to anon, authenticated;

-- ──────────────────────────── 8.3 Storage：review-images ────────────────────────────
-- 公開讀取（public bucket，用 /object/public/ 網址讀，跟 product-images 一樣）。
-- bucket 層級限制：只收 image/jpeg、單檔 2 MB（2097152 bytes）。
-- 寫入（INSERT）：anon 與 authenticated 都只能寫「開著的上傳位置」的路徑。
-- 不建 UPDATE、DELETE policy：已上傳的檔案不能被覆蓋、修改或刪除；刪除只走 Storage API（service role，清理腳本）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

drop policy if exists review_images_insert on storage.objects;
create policy review_images_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'review-images' and public._rv_slot_open(name));

-- ──────────────────────────── 8.6 收緊訂單憑證（D10） ────────────────────────────
-- 預設權限把 orders 全開給 anon／authenticated（只靠 RLS 擋）。收回後，只給 authenticated：
--   讀：15 個欄位（前端 SHOP_ORDER_FIELDS），不含 access_token；
--   改：status、carrier、tracking_no。
-- 於是 select('*')、select access_token、改 access_token／total／lines／buyer_* 都會得到 permission denied。
-- anon 本來就沒有任何 orders 的 RLS policy（讀寫都不行），這裡一併收回權限，被擋時會明確報錯。
-- 不受影響：place_order、get_my_orders、cancel_my_order、complete_my_order、add_order_event 都是 SECURITY DEFINER；
--   track_order_event trigger 只改 NEW，不需要欄位權限。
-- 注意：orders 日後新增的欄位，authenticated 預設讀不到，要另外 grant select (欄位)。

revoke all on public.orders from anon, authenticated;
grant select (id, order_no, shop_id, lines, shipping_fee, total, status, payment, created_at,
              carrier, tracking_no, events, buyer_name, buyer_phone, buyer_address)
  on public.orders to authenticated;
grant update (status, carrier, tracking_no) on public.orders to authenticated;
