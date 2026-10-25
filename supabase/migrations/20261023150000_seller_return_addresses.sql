-- 賣家物流設定：退貨地址（.work/seller-logistics/spec.md v0.1，工單 L-B1；decisions.md D4～D17、N1＝A）
--
-- 只做相容的新增：三張新表（return_stores、return_personal_addresses、return_notes）與八個新 RPC。
-- 不動任何既有的表、欄位、權限、函式；舊前端不讀這些，所以先套資料庫、再推前端都安全。
-- 只依賴 20261018170000（tw_districts）與更早的函式（_acct_uid、_rv_raise、_rv_trim）；
-- 不依賴 20261018180100 之後的任何 migration，所以也能套在「尚未套 ecpay／refunds 的正式站」（R-L20）。
--
-- 這是「受控的個資揭露」：賣家存退貨收件人姓名、手機、地址，只有「該訂單（運送中／已完成）的登入買家」
-- 經帶訂單 ID 的 get_order_return_info 讀得到。安全邊界：
--   · 三張表對 anon、authenticated 都不 grant 任何權限（連 select 都沒有），RLS 也開著且不建 policy。
--     店主讀自己的設定走 get_my_return_settings；寫入走 RPC；買家只有 get_order_return_info。
--   · 表不放在 shops（shops 對全世界公開可讀），也不直接指向 auth.users：
--     三張表只指向 shops(id) ON DELETE CASCADE，店被刪（含刪店主帳號連帶刪店）時一併消失。
--     所以刪帳號工具的「指向 auth.users 的外鍵」清單不變；刪店工具要多認得這三張表（L-B2）。
--   · 欄位規則在 RPC 擋一次、表層 CHECK／trigger 再擋一次（連 service role 直接寫入也擋）。
--
-- 錯誤格式沿用地址簿慣例：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）。地址欄位錯誤沿用 ADDRESS_* 碼。
-- 帳號版 RPC 開給 anon（慣例同 buyer_accounts_m1）：session 過期時得到中文的 NOT_AUTHENTICATED。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 資料表
-- ═══════════════════════════════════════════════════════════════════════

-- 退貨門市：每店最多 5 筆（trigger＋advisory lock 保證，競爭下也成立）；有任一筆時恰好一筆預設（≤1 靠部分唯一索引，≥1 靠 RPC）。
-- 超商品牌存代碼（不存畫面字樣，字樣改了不用動資料）：seven_eleven／familymart／hilife／okmart。
-- 字數一律 char_length（code point）；前端要用 [...s].length，不要用 s.length。手機只存 10 碼數字。
create table if not exists public.return_stores (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  brand       text not null,
  store_name  text not null,
  recipient   text not null,
  phone       text not null,
  city        text not null,
  district    text not null,
  postal_code text not null,
  detail      text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint return_stores_brand_valid     check (brand in ('seven_eleven', 'familymart', 'hilife', 'okmart')),
  constraint return_stores_name_valid      check (char_length(store_name) between 1 and 20 and store_name !~ '[[:cntrl:]]'),
  constraint return_stores_recipient_valid check (char_length(recipient) between 1 and 20 and recipient !~ '[[:cntrl:]]'),
  constraint return_stores_phone_valid     check (phone ~ '^09[0-9]{8}$'),
  constraint return_stores_postal_valid    check (postal_code ~ '^[0-9]{3}$'),
  constraint return_stores_detail_valid    check (char_length(detail) >= 2 and detail !~ '[[:cntrl:]]'),
  constraint return_stores_length_valid    check (char_length(city) + char_length(district) + char_length(detail) <= 60)
);
create index if not exists return_stores_shop_idx on public.return_stores (shop_id, is_default desc, created_at);
-- 每店最多一筆預設門市（R-L4）：競爭下也成立（寫入還有 advisory lock 排隊，所以前端不會看到這個索引的英文錯誤）
create unique index if not exists return_stores_one_default_per_shop on public.return_stores (shop_id) where is_default;

-- 個人地址（宅配退貨用）：每店最多 1 筆，用 shop_id 當主鍵保證（R-L7），沒有預設概念。
create table if not exists public.return_personal_addresses (
  shop_id     uuid primary key references public.shops(id) on delete cascade,
  recipient   text not null,
  phone       text not null,
  city        text not null,
  district    text not null,
  postal_code text not null,
  detail      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint return_personal_recipient_valid check (char_length(recipient) between 1 and 20 and recipient !~ '[[:cntrl:]]'),
  constraint return_personal_phone_valid     check (phone ~ '^09[0-9]{8}$'),
  constraint return_personal_postal_valid    check (postal_code ~ '^[0-9]{3}$'),
  constraint return_personal_detail_valid    check (char_length(detail) >= 2 and detail !~ '[[:cntrl:]]'),
  constraint return_personal_length_valid    check (char_length(city) + char_length(district) + char_length(detail) <= 60)
);

-- 退貨說明（選填，≤ 200 字）：每店最多 1 筆；空＝這一列不存在。可換行（只留 \n），不可有其他控制字元；不可只有空白。
create table if not exists public.return_notes (
  shop_id    uuid primary key references public.shops(id) on delete cascade,
  note       text not null,
  updated_at timestamptz not null default now(),
  constraint return_notes_length_valid check (char_length(note) between 1 and 200),
  constraint return_notes_chars_valid  check (note !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]'),
  constraint return_notes_not_blank    check (note ~ '[^\s 　]')
);

-- 權限：三張表對前端完全不開放（連 select 都沒有）。RLS 開著且不建 policy，是第二道鎖。
alter table public.return_stores              enable row level security;
alter table public.return_personal_addresses  enable row level security;
alter table public.return_notes               enable row level security;
revoke all on public.return_stores             from public, anon, authenticated;
revoke all on public.return_personal_addresses from public, anon, authenticated;
revoke all on public.return_notes              from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 觸發器：updated_at、上限 5 筆、縣市／區／郵遞區號組合、所屬店不可改（任何寫入路徑都擋，包含 service role）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._rtn_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public._rtn_touch() from public, anon, authenticated;

drop trigger if exists return_stores_touch on public.return_stores;
create trigger return_stores_touch before update on public.return_stores
  for each row execute function public._rtn_touch();
drop trigger if exists return_personal_touch on public.return_personal_addresses;
create trigger return_personal_touch before update on public.return_personal_addresses
  for each row execute function public._rtn_touch();
drop trigger if exists return_notes_touch on public.return_notes;
create trigger return_notes_touch before update on public.return_notes
  for each row execute function public._rtn_touch();

-- 縣市＋區＋郵遞區號是否在清單裡。用 trigger／函式核對而不是外鍵：行政區調整時外鍵會擋住清單的增刪，
-- 也會逼我們改已存的地址（同 _addr_guard 的理由）。
create or replace function public._rtn_region_ok(p_city text, p_district text, p_zip text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tw_districts d
                  where d.city = p_city and d.district = p_district and d.postal_code = p_zip);
$$;
revoke all on function public._rtn_region_ok(text, text, text) from public, anon, authenticated;

create or replace function public._rtn_store_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if tg_op = 'UPDATE' and new.shop_id <> old.shop_id then
    raise exception '不能把退貨門市轉給別的店' using hint = 'RETURN_STORE_OWNER_IMMUTABLE';
  end if;
  if tg_op = 'INSERT' then
    -- 同一家店的新增排隊，count 才不會被兩個同時進來的交易一起看到 4
    perform pg_advisory_xact_lock(hashtextextended('rtn-store:' || new.shop_id::text, 0));
    select count(*) into v_n from public.return_stores where shop_id = new.shop_id;
    if v_n >= 5 then
      raise exception '退貨門市最多只能存 5 間' using hint = 'RETURN_STORE_LIMIT_REACHED';
    end if;
  end if;
  if tg_op = 'INSERT' or (new.city, new.district, new.postal_code) is distinct from (old.city, old.district, old.postal_code) then
    if not public._rtn_region_ok(new.city, new.district, new.postal_code) then
      raise exception '縣市、鄉鎮市區與郵遞區號不相符，請重新選擇' using hint = 'ADDRESS_REGION_INVALID';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._rtn_store_guard() from public, anon, authenticated;

drop trigger if exists return_stores_guard on public.return_stores;
create trigger return_stores_guard before insert or update on public.return_stores
  for each row execute function public._rtn_store_guard();

create or replace function public._rtn_address_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.shop_id <> old.shop_id then
    raise exception '不能把退貨地址轉給別的店' using hint = 'RETURN_ADDRESS_OWNER_IMMUTABLE';
  end if;
  if tg_op = 'INSERT' or (new.city, new.district, new.postal_code) is distinct from (old.city, old.district, old.postal_code) then
    if not public._rtn_region_ok(new.city, new.district, new.postal_code) then
      raise exception '縣市、鄉鎮市區與郵遞區號不相符，請重新選擇' using hint = 'ADDRESS_REGION_INVALID';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._rtn_address_guard() from public, anon, authenticated;

drop trigger if exists return_personal_guard on public.return_personal_addresses;
create trigger return_personal_guard before insert or update on public.return_personal_addresses
  for each row execute function public._rtn_address_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 內部工具函式（不開放給前端）
-- ═══════════════════════════════════════════════════════════════════════

-- 呼叫者的店 id。沒登入（含 session 過期）→ NOT_AUTHENTICATED；登入但沒開店 → NO_SHOP。
-- 每個帳號最多一家店（shops_owner_unique）。
create or replace function public._rtn_shop()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := public._acct_uid('請先登入');
  v_shop uuid;
begin
  select s.id into v_shop from public.shops s where s.owner_id = v_uid;
  if v_shop is null then
    perform public._rv_raise('NO_SHOP', '這個帳號還沒有開店');
  end if;
  return v_shop;
end $$;
revoke all on function public._rtn_shop() from public, anon, authenticated;

-- 收件人／手機／縣市／區／郵遞區號／詳細地址的驗證與正規化（R-L8，規則與 save_address 完全相同）。
-- 回傳正規化後的 {recipient, phone, city, district, postal_code, detail}；有錯就丟 ADDRESS_* 錯誤。
create or replace function public._rtn_validate_address(
  p_recipient text, p_phone text, p_city text, p_district text, p_postal_code text, p_detail text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_recipient text := public._rv_trim(coalesce(p_recipient, ''));
  v_phone     text := public._rv_trim(coalesce(p_phone, ''));
  v_city      text := public._rv_trim(coalesce(p_city, ''));
  v_district  text := public._rv_trim(coalesce(p_district, ''));
  v_zip       text := public._rv_trim(coalesce(p_postal_code, ''));
  v_detail    text := public._rv_trim(coalesce(p_detail, ''));
begin
  if char_length(v_recipient) not between 1 and 20 or v_recipient ~ '[[:cntrl:]]' then
    perform public._rv_raise('ADDRESS_RECIPIENT_INVALID', '收件人需為 1 到 20 個字');
  end if;
  if v_phone !~ '^09[0-9]{2}-?[0-9]{3}-?[0-9]{3}$' then
    perform public._rv_raise('ADDRESS_PHONE_INVALID', '手機號碼需為 09 開頭的 10 碼數字');
  end if;
  v_phone := replace(v_phone, '-', '');
  if not public._rtn_region_ok(v_city, v_district, v_zip) then
    perform public._rv_raise('ADDRESS_REGION_INVALID', '縣市、鄉鎮市區與郵遞區號不相符，請重新選擇');
  end if;
  if char_length(v_detail) < 2 or v_detail ~ '[[:cntrl:]]' then
    perform public._rv_raise('ADDRESS_DETAIL_INVALID', '詳細地址至少需要 2 個字');
  end if;
  if char_length(v_city) + char_length(v_district) + char_length(v_detail) > 60 then
    perform public._rv_raise('ADDRESS_TOO_LONG', '縣市、鄉鎮市區與詳細地址合計最多 60 個字');
  end if;
  return jsonb_build_object('recipient', v_recipient, 'phone', v_phone, 'city', v_city,
                            'district', v_district, 'postal_code', v_zip, 'detail', v_detail);
end $$;
revoke all on function public._rtn_validate_address(text, text, text, text, text, text) from public, anon, authenticated;

-- 賣家端看的 JSON（店主看自己的資料；不含 shop_id）
create or replace function public._rtn_store_json(s public.return_stores)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'brand', s.brand, 'store_name', s.store_name, 'recipient', s.recipient, 'phone', s.phone,
    'city', s.city, 'district', s.district, 'postal_code', s.postal_code, 'detail', s.detail,
    'is_default', s.is_default, 'created_at', s.created_at, 'updated_at', s.updated_at);
$$;
revoke all on function public._rtn_store_json(public.return_stores) from public, anon, authenticated;

create or replace function public._rtn_personal_json(a public.return_personal_addresses)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'recipient', a.recipient, 'phone', a.phone, 'city', a.city, 'district', a.district,
    'postal_code', a.postal_code, 'detail', a.detail, 'created_at', a.created_at, 'updated_at', a.updated_at);
$$;
revoke all on function public._rtn_personal_json(public.return_personal_addresses) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RPC：店主
-- ═══════════════════════════════════════════════════════════════════════

-- 讀自己店的全部退貨設定。stores 預設在前（其後依建立時間）；沒有就是 []／null。
create or replace function public.get_my_return_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
begin
  return jsonb_build_object(
    'stores', coalesce((select jsonb_agg(public._rtn_store_json(s) order by s.is_default desc, s.created_at, s.id)
                          from public.return_stores s where s.shop_id = v_shop), '[]'::jsonb),
    'personal', (select public._rtn_personal_json(a) from public.return_personal_addresses a where a.shop_id = v_shop),
    'note', (select n.note from public.return_notes n where n.shop_id = v_shop));
end $$;

-- 新增（p_id is null）或編輯（p_id 有值）一間退貨門市，回傳存好的那一筆（賣家端 JSON）。
--   · 超商品牌四選一（seven_eleven／familymart／hilife／okmart）；門市名稱 1～20 字；其餘欄位規則同 save_address。
--   · 店的第一筆自動是預設。p_is_default = true 時，同一個交易裡取消舊預設。
--     目前的預設那筆傳 false：忽略，維持預設（預設只能用「改設別筆為預設」移走）。
--   · 新增時已有 5 筆 → RETURN_STORE_LIMIT_REACHED；編輯的 id 不存在或不是本店的 → RETURN_STORE_NOT_FOUND。
create or replace function public.save_return_store(
  p_id          uuid,
  p_brand       text,
  p_store_name  text,
  p_recipient   text,
  p_phone       text,
  p_city        text,
  p_district    text,
  p_postal_code text,
  p_detail      text,
  p_is_default  boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop    uuid := public._rtn_shop();
  v_name    text := public._rv_trim(coalesce(p_store_name, ''));
  v_addr    jsonb;
  v_row     public.return_stores;
  v_n       integer;
  v_default boolean;
begin
  if p_brand is null or p_brand not in ('seven_eleven', 'familymart', 'hilife', 'okmart') then
    perform public._rv_raise('RETURN_STORE_BRAND_INVALID', '請選擇超商品牌');
  end if;
  if char_length(v_name) not between 1 and 20 or v_name ~ '[[:cntrl:]]' then
    perform public._rv_raise('RETURN_STORE_NAME_INVALID', '門市名稱需為 1 到 20 個字');
  end if;
  v_addr := public._rtn_validate_address(p_recipient, p_phone, p_city, p_district, p_postal_code, p_detail);

  -- 同一家店的所有門市寫入排隊（和 _rtn_store_guard 用同一把鎖；advisory xact lock 同一交易可重複取得）
  perform pg_advisory_xact_lock(hashtextextended('rtn-store:' || v_shop::text, 0));

  if p_id is null then
    select count(*) into v_n from public.return_stores where shop_id = v_shop;
    if v_n >= 5 then
      perform public._rv_raise('RETURN_STORE_LIMIT_REACHED', '退貨門市最多只能存 5 間');
    end if;
    v_default := coalesce(p_is_default, false) or v_n = 0;
    if v_default then
      update public.return_stores set is_default = false where shop_id = v_shop and is_default;
    end if;
    insert into public.return_stores (shop_id, brand, store_name, recipient, phone, city, district, postal_code, detail, is_default)
    values (v_shop, p_brand, v_name, v_addr->>'recipient', v_addr->>'phone', v_addr->>'city', v_addr->>'district',
            v_addr->>'postal_code', v_addr->>'detail', v_default)
    returning * into v_row;
  else
    select * into v_row from public.return_stores where id = p_id and shop_id = v_shop for update;
    if not found then
      perform public._rv_raise('RETURN_STORE_NOT_FOUND', '這間退貨門市已經被刪除');
    end if;
    v_default := coalesce(p_is_default, false) or v_row.is_default;
    if v_default and not v_row.is_default then
      update public.return_stores set is_default = false where shop_id = v_shop and is_default;
    end if;
    update public.return_stores
       set brand = p_brand, store_name = v_name, recipient = v_addr->>'recipient', phone = v_addr->>'phone',
           city = v_addr->>'city', district = v_addr->>'district', postal_code = v_addr->>'postal_code',
           detail = v_addr->>'detail', is_default = v_default
     where id = p_id and shop_id = v_shop
    returning * into v_row;
  end if;
  return public._rtn_store_json(v_row);
end $$;

-- 設為預設：同一個交易裡取消舊預設、設新預設。已經是預設就原樣回傳。
create or replace function public.set_default_return_store(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
  v_row  public.return_stores;
begin
  perform pg_advisory_xact_lock(hashtextextended('rtn-store:' || v_shop::text, 0));
  select * into v_row from public.return_stores where id = p_id and shop_id = v_shop for update;
  if not found then
    perform public._rv_raise('RETURN_STORE_NOT_FOUND', '這間退貨門市已經被刪除');
  end if;
  if not v_row.is_default then
    update public.return_stores set is_default = false where shop_id = v_shop and is_default;
    update public.return_stores set is_default = true where id = p_id and shop_id = v_shop returning * into v_row;
  end if;
  return public._rtn_store_json(v_row);
end $$;

-- 刪除：預設那筆在還有別筆時不能刪（R-L6）；只剩它時可以刪，刪完該店沒有門市。
create or replace function public.delete_return_store(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
  v_row  public.return_stores;
  v_n    integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('rtn-store:' || v_shop::text, 0));
  select * into v_row from public.return_stores where id = p_id and shop_id = v_shop for update;
  if not found then
    perform public._rv_raise('RETURN_STORE_NOT_FOUND', '這間退貨門市已經被刪除');
  end if;
  select count(*) into v_n from public.return_stores where shop_id = v_shop;
  if v_row.is_default and v_n > 1 then
    perform public._rv_raise('RETURN_STORE_DEFAULT_PROTECTED', '預設門市不能刪除，請先把別筆設為預設');
  end if;
  delete from public.return_stores where id = p_id and shop_id = v_shop;
end $$;

-- 個人地址：有就更新、沒有就建立（每店 1 筆，沒有預設概念）。回傳存好的那一筆。
create or replace function public.save_return_personal_address(
  p_recipient   text,
  p_phone       text,
  p_city        text,
  p_district    text,
  p_postal_code text,
  p_detail      text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
  v_addr jsonb;
  v_row  public.return_personal_addresses;
begin
  v_addr := public._rtn_validate_address(p_recipient, p_phone, p_city, p_district, p_postal_code, p_detail);
  insert into public.return_personal_addresses (shop_id, recipient, phone, city, district, postal_code, detail)
  values (v_shop, v_addr->>'recipient', v_addr->>'phone', v_addr->>'city', v_addr->>'district',
          v_addr->>'postal_code', v_addr->>'detail')
  on conflict (shop_id) do update
     set recipient = excluded.recipient, phone = excluded.phone, city = excluded.city, district = excluded.district,
         postal_code = excluded.postal_code, detail = excluded.detail
  returning * into v_row;
  return public._rtn_personal_json(v_row);
end $$;

-- 刪除個人地址：本來就沒有時也成功。
create or replace function public.delete_return_personal_address()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
begin
  delete from public.return_personal_addresses where shop_id = v_shop;
end $$;

-- 設定（或清除）退貨說明。p_note 為 null、空字串、只有空白＝清除（該列刪除）。
--   · 前後空白去掉；\r\n 與 \r 先轉成 \n；除了 \n 以外的控制字元 → RETURN_NOTE_INVALID；
--     去空白後超過 200 個字（code point）→ RETURN_NOTE_TOO_LONG。
create or replace function public.set_return_note(p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public._rtn_shop();
  v_note text := public._rv_trim(replace(replace(coalesce(p_note, ''), E'\r\n', E'\n'), E'\r', E'\n'));
begin
  if v_note = '' then
    delete from public.return_notes where shop_id = v_shop;
    return jsonb_build_object('note', null);
  end if;
  if v_note ~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]' then
    perform public._rv_raise('RETURN_NOTE_INVALID', '退貨說明含有不能使用的字元');
  end if;
  if char_length(v_note) > 200 then
    perform public._rv_raise('RETURN_NOTE_TOO_LONG', '退貨說明最多 200 個字');
  end if;
  insert into public.return_notes (shop_id, note) values (v_shop, v_note)
  on conflict (shop_id) do update set note = excluded.note;
  return jsonb_build_object('note', v_note);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC：買家（唯一的買家讀取路徑，R-L12／R-L13）
-- ═══════════════════════════════════════════════════════════════════════
-- 條件：呼叫者已登入、是這張訂單的 buyer_id、訂單狀態是 shipping 或 completed。
--   · 沒登入 → NOT_AUTHENTICATED
--   · 訂單不存在、不是自己的（含店主用自己店的訂單 id、訪客訂單）→ 同一個 ORDER_NOT_FOUND，不洩漏訂單是否存在
--   · 自己的訂單但待出貨／已取消 → RETURN_INFO_NOT_AVAILABLE（不回任何退貨資料）
-- 回傳只含：預設門市（品牌、門市名稱、收件人、手機、地址四欄）、個人地址（收件人、手機、地址四欄）、退貨說明；
-- 沒有的就是 null。不含非預設門市、shop_id、賣家帳號、時間戳。即時讀賣家目前的設定，不存快照（D10）。
create or replace function public.get_order_return_info(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := public._acct_uid('請先登入');
  v_shop   uuid;
  v_status text;
  v_store  jsonb;
  v_pers   jsonb;
begin
  select o.shop_id, o.status into v_shop, v_status
    from public.orders o
   where o.id = p_order and o.buyer_id = v_uid;
  if not found then
    perform public._rv_raise('ORDER_NOT_FOUND', '找不到這張訂單');
  end if;
  if v_status is null or v_status not in ('shipping', 'completed') then
    perform public._rv_raise('RETURN_INFO_NOT_AVAILABLE', '訂單出貨後才能查看退貨資訊');
  end if;

  select jsonb_build_object('brand', s.brand, 'store_name', s.store_name, 'recipient', s.recipient, 'phone', s.phone,
                            'city', s.city, 'district', s.district, 'postal_code', s.postal_code, 'detail', s.detail)
    into v_store
    from public.return_stores s where s.shop_id = v_shop and s.is_default;
  select jsonb_build_object('recipient', a.recipient, 'phone', a.phone, 'city', a.city, 'district', a.district,
                            'postal_code', a.postal_code, 'detail', a.detail)
    into v_pers
    from public.return_personal_addresses a where a.shop_id = v_shop;

  return jsonb_build_object('store', v_store, 'personal', v_pers,
                            'note', (select n.note from public.return_notes n where n.shop_id = v_shop));
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 函式權限
-- ═══════════════════════════════════════════════════════════════════════
revoke all on function public.get_my_return_settings()                                                                      from public;
revoke all on function public.save_return_store(uuid, text, text, text, text, text, text, text, text, boolean)              from public;
revoke all on function public.set_default_return_store(uuid)                                                                from public;
revoke all on function public.delete_return_store(uuid)                                                                     from public;
revoke all on function public.save_return_personal_address(text, text, text, text, text, text)                              from public;
revoke all on function public.delete_return_personal_address()                                                              from public;
revoke all on function public.set_return_note(text)                                                                         from public;
revoke all on function public.get_order_return_info(uuid)                                                                   from public;
grant execute on function public.get_my_return_settings()                                                                      to anon, authenticated;
grant execute on function public.save_return_store(uuid, text, text, text, text, text, text, text, text, boolean)              to anon, authenticated;
grant execute on function public.set_default_return_store(uuid)                                                                to anon, authenticated;
grant execute on function public.delete_return_store(uuid)                                                                     to anon, authenticated;
grant execute on function public.save_return_personal_address(text, text, text, text, text, text)                              to anon, authenticated;
grant execute on function public.delete_return_personal_address()                                                              to anon, authenticated;
grant execute on function public.set_return_note(text)                                                                         to anon, authenticated;
grant execute on function public.get_order_return_info(uuid)                                                                   to anon, authenticated;
