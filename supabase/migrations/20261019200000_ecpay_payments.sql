-- 綠界特約合作平台商：買家信用卡付款的資料層（.work/account-payment-methods/ 工單 B-T2 ＋ C-T2 資料部分；decisions.md D3＝B、D18～D25）
--
-- 只做相容的新增，不改任何既有欄位的語意：
--   · 新表：payment_config（功能開關，預設關）、payment_members、payment_methods、ecpay_bind_attempts、
--           payment_groups、payment_auths、seller_ecpay_merchants。全部開 RLS；BindCardID 所在的表 anon／authenticated 沒有任何權限。
--   · orders 加 8 個欄位（payment_status 預設 'none'＝貨到付款與歷史訂單），authenticated 讀不到（逐欄 grant 的慣例）。
--   · orders_payment_check 放寬：多一個 'ecpay_card'（真的信用卡）。歷史的 'card' 仍是示範值，永遠不會被當成已付款（R-B12）。
--   · 賣家看訂單的兩個 policy 多一個條件：未完成付款的線上訂單賣家看不到、改不了（R-B8）。對舊前端只是「列比較少」，不是 403。
--   · cancel_account_order：已付款／確認中的線上訂單不能自行取消（沒有退款流程，K-9）；待付款的線上訂單取消時退回庫存。
--   · 新 RPC：place_online_order、get_payment_config、get_shops_online_payable、get_order_payments、get_payment_group、
--             set_default_payment_method、submit_seller_ecpay_merchant、expire_my_pending_orders。
--   · 伺服器端專用函式（只有 service_role 能執行，給 Edge Functions）：pay_*、bind_*、method_*、expire_pending_online_orders。
--
-- 錯誤格式沿用 _rv_raise：message＝中文、hint＝錯誤碼。錯誤碼對照見 .work/account-payment-methods/interface-payment.md。
-- 可重複執行；整個檔案一個交易，任何一步失敗就整個回滾。
begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 功能開關（預設關）
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.payment_config (
  id                      boolean primary key default true check (id),   -- 只允許一列
  online_payment_enabled  boolean not null default false,
  updated_at              timestamptz not null default now()
);
insert into public.payment_config (id) values (true) on conflict (id) do nothing;
alter table public.payment_config enable row level security;
revoke all on public.payment_config from public, anon, authenticated;

create or replace function public._pay_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select online_payment_enabled from public.payment_config where id), false);
$$;
revoke all on function public._pay_enabled() from public, anon, authenticated;

create or replace function public.get_payment_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('onlinePaymentEnabled', public._pay_enabled());
$$;
revoke all on function public.get_payment_config() from public;
grant execute on function public.get_payment_config() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 賣家特約商店（P-C 資料部分）
-- ═══════════════════════════════════════════════════════════════════════
-- 綠界文件沒有查詢特約商店狀態的 API（搜尋「特店狀態」「進件」「子特店」皆無結果），狀態由維運人員在綠界後台核對後改（runbook 有 SQL）。
create table if not exists public.seller_ecpay_merchants (
  shop_id           uuid primary key references public.shops(id) on delete cascade,
  ecpay_merchant_id text not null unique check (ecpay_merchant_id ~ '^[0-9]{7,10}$'),
  status            text not null default 'pending_review' check (status in ('pending_review', 'active', 'rejected', 'suspended')),
  reason            text,                       -- 被退回／停用的原因（給賣家看）
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  activated_at      timestamptz
);
alter table public.seller_ecpay_merchants enable row level security;
revoke all on public.seller_ecpay_merchants from public, anon, authenticated;
grant select on public.seller_ecpay_merchants to authenticated;
drop policy if exists seller_ecpay_merchants_read_own on public.seller_ecpay_merchants;
create policy seller_ecpay_merchants_read_own on public.seller_ecpay_merchants for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

-- 賣家填入自己在綠界開好的特約商店編號 → 待審核。賣家不能自己改成可收款。
create or replace function public.submit_seller_ecpay_merchant(p_merchant_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._acct_uid();
  v_shop uuid;
  v_cur  public.seller_ecpay_merchants;
  v_id   text := btrim(coalesce(p_merchant_id, ''));
begin
  select s.id into v_shop from public.shops s where s.owner_id = v_uid;
  if v_shop is null then perform public._rv_raise('NO_SHOP', '你還沒有開店'); end if;
  if v_id !~ '^[0-9]{7,10}$' then perform public._rv_raise('MERCHANT_ID_INVALID', '特約商店編號格式不正確（7 到 10 位數字）'); end if;
  select * into v_cur from public.seller_ecpay_merchants where shop_id = v_shop for update;
  if found and v_cur.status = 'active' then
    perform public._rv_raise('MERCHANT_ALREADY_ACTIVE', '收款帳戶已開通，要更換請聯絡平台');
  end if;
  if exists (select 1 from public.seller_ecpay_merchants m where m.ecpay_merchant_id = v_id and m.shop_id <> v_shop) then
    perform public._rv_raise('MERCHANT_ID_TAKEN', '這個特約商店編號已被使用');
  end if;
  insert into public.seller_ecpay_merchants (shop_id, ecpay_merchant_id, status, reason)
  values (v_shop, v_id, 'pending_review', null)
  on conflict (shop_id) do update set ecpay_merchant_id = excluded.ecpay_merchant_id, status = 'pending_review', reason = null, updated_at = now();
  return jsonb_build_object('status', 'pending_review');
end $$;
revoke all on function public.submit_seller_ecpay_merchant(text) from public;
grant execute on function public.submit_seller_ecpay_merchant(text) to anon, authenticated;

-- 結帳頁問：這幾家店能不能線上付款（不洩漏特約商店編號）
create or replace function public.get_shops_online_payable(p_shop_ids uuid[])
returns table (shop_id uuid, online_payable boolean)
language sql stable security definer set search_path = public as $$
  select s.id, public._pay_enabled() and coalesce(m.status = 'active', false)
    from public.shops s left join public.seller_ecpay_merchants m on m.shop_id = s.id
   where s.id = any (coalesce(p_shop_ids, '{}'));
$$;
revoke all on function public.get_shops_online_payable(uuid[]) from public;
grant execute on function public.get_shops_online_payable(uuid[]) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 買家付款方式（卡）
-- ═══════════════════════════════════════════════════════════════════════
-- 平台商會員編號：一個帳號一個不可猜的代號（不用 auth.users.id，避免 id 外流時被拿去查綠界）
create table if not exists public.payment_members (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  merchant_member_id text not null unique default ('m' || replace(gen_random_uuid()::text, '-', '')),
  created_at         timestamptz not null default now()
);
alter table public.payment_members enable row level security;
revoke all on public.payment_members from public, anon, authenticated;

create table if not exists public.payment_methods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  bind_card_id text not null,                       -- 綠界 BindCardID：能拿來扣款，等同密鑰。anon／authenticated 完全沒有這張表的權限
  card6        text not null check (card6 ~ '^[0-9]{6}$'),
  card4        text not null check (card4 ~ '^[0-9]{4}$'),
  exp_month    text not null check (exp_month ~ '^[0-9]{2}$'),
  exp_year     text not null check (exp_year ~ '^[0-9]{2}$'),
  is_default   boolean not null default false,
  status       text not null default 'active' check (status in ('active', 'revoking')),   -- revoking＝已隱藏、不能扣款，等伺服器向綠界撤銷
  revoke_failures integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, bind_card_id)
);
create unique index if not exists payment_methods_one_default on public.payment_methods (user_id) where is_default and status = 'active';
create index if not exists payment_methods_user_idx on public.payment_methods (user_id, created_at);
alter table public.payment_methods enable row level security;
revoke all on public.payment_methods from public, anon, authenticated;

-- 前端讀卡片列表的唯一入口：沒有 bind_card_id。view 以擁有者身分執行，用 auth.uid() 自己篩。
create or replace view public.my_payment_methods as
  select m.id, m.card6, m.card4, m.exp_month, m.exp_year, m.is_default, m.created_at,
         case when m.card6 like '4%' then 'visa'
              when m.card6 ~ '^(5[1-5]|2[2-7])' then 'mastercard'
              when m.card6 like '35%' then 'jcb'
              when m.card6 like '62%' then 'unionpay'
              when m.card6 ~ '^3[47]' then 'amex'
              else 'other' end as brand,
         (to_date('20' || m.exp_year || m.exp_month, 'YYYYMM') + interval '1 month') <= date_trunc('month', now() at time zone 'Asia/Taipei') as expired
    from public.payment_methods m
   where m.user_id = auth.uid() and m.status = 'active';
revoke all on public.my_payment_methods from public, anon, authenticated;
grant select on public.my_payment_methods to authenticated;

-- 一個帳號最多 5 張（綠界也是 5 張；這裡先擋，連同撤銷中的一起算，因為綠界那邊還佔著名額）
create or replace function public._payment_methods_limit() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.payment_methods m where m.user_id = new.user_id) >= 5 then
    raise exception '最多只能綁定 5 張信用卡，請先刪除一張' using hint = 'CARD_LIMIT';
  end if;
  return new;
end $$;
revoke all on function public._payment_methods_limit() from public, anon, authenticated;
drop trigger if exists payment_methods_limit on public.payment_methods;
create trigger payment_methods_limit before insert on public.payment_methods for each row execute function public._payment_methods_limit();

-- 設為預設（同一個交易裡取消舊預設）
create or replace function public.set_default_payment_method(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid();
begin
  perform 1 from public.payment_methods m where m.id = p_id and m.user_id = v_uid and m.status = 'active' for update;
  if not found then perform public._rv_raise('CARD_NOT_FOUND', '找不到這張卡'); end if;
  update public.payment_methods set is_default = false, updated_at = now() where user_id = v_uid and is_default and id <> p_id;
  update public.payment_methods set is_default = true, updated_at = now() where id = p_id;
end $$;
revoke all on function public.set_default_payment_method(uuid) from public;
grant execute on function public.set_default_payment_method(uuid) to anon, authenticated;

-- 綁卡嘗試（一次「新增卡片」＝一筆）
create table if not exists public.ecpay_bind_attempts (
  id                 uuid primary key default gen_random_uuid(),
  merchant_trade_no  text not null unique check (merchant_trade_no ~ '^[A-Za-z0-9]{1,20}$'),
  user_id            uuid references auth.users(id) on delete set null,
  merchant_member_id text not null,
  return_path        text,                       -- 綁卡結果頁要導回前端的哪個站內路徑（bind-start 驗證過：以 / 開頭）
  status             text not null default 'created' check (status in ('created', 'confirming', 'bound', 'failed')),
  rtn_code           integer,
  rtn_msg            text,
  ecpay_trade_no     text,
  is_same_card       boolean,
  payment_method_id  uuid references public.payment_methods(id) on delete set null,
  void_state         text not null default 'none' check (void_state in ('none', 'pending', 'done')),  -- 綁卡用的最低金額授權要放棄（35591）
  void_failures      integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ecpay_bind_attempts_open_idx on public.ecpay_bind_attempts (status, created_at) where status in ('created', 'confirming');
create index if not exists ecpay_bind_attempts_void_idx on public.ecpay_bind_attempts (void_state) where void_state = 'pending';
alter table public.ecpay_bind_attempts enable row level security;
revoke all on public.ecpay_bind_attempts from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 付款群組（一次結帳）與授權（群組內每張訂單、每次嘗試一筆）
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.payment_groups (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,   -- 財務紀錄不隨帳號刪除
  status            text not null default 'pending' check (status in ('pending', 'processing', 'confirming', 'paid', 'failed', 'expired', 'cancelled')),
  decision          text check (decision in ('capture', 'abandon')),
  attempt_no        integer not null default 0,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  total             integer not null,
  expires_at        timestamptz not null,
  lease_until       timestamptz,
  last_fail         jsonb,
  confirm_reason    text,
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payment_groups_user_idx on public.payment_groups (user_id, created_at desc);
create index if not exists payment_groups_open_idx on public.payment_groups (status, expires_at) where status in ('pending', 'processing', 'confirming');
alter table public.payment_groups enable row level security;
revoke all on public.payment_groups from public, anon, authenticated;

create table if not exists public.payment_auths (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.payment_groups(id),
  order_id          uuid references public.orders(id) on delete set null,
  shop_id           uuid not null,
  attempt_no        integer not null,
  merchant_id       text not null,
  merchant_trade_no text not null unique check (merchant_trade_no ~ '^[A-Za-z0-9]{1,20}$'),
  amount            integer not null check (amount > 0 and amount <= 200000),   -- 綠界單筆授權上限 20 萬（35630）
  state             text not null default 'pending' check (state in ('pending', 'calling', 'authorized', 'declined', 'captured', 'abandoned')),
  ecpay_trade_no    text,
  rtn_code          integer,
  rtn_msg           text,
  call_started_at   timestamptz,
  action_failures   integer not null default 0,
  resolved_by_query boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payment_auths_group_idx on public.payment_auths (group_id, attempt_no);
alter table public.payment_auths enable row level security;
revoke all on public.payment_auths from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. orders 新欄位（authenticated 讀不到、改不到：沿用逐欄 grant 的慣例，新欄位預設無權限）
-- ═══════════════════════════════════════════════════════════════════════
alter table public.orders add column if not exists payment_status text not null default 'none';
alter table public.orders add column if not exists ecpay_trade_no text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists pay_group_id uuid references public.payment_groups(id);
alter table public.orders add column if not exists pay_expires_at timestamptz;
alter table public.orders add column if not exists pay_card_brand text;
alter table public.orders add column if not exists pay_card4 text;

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('none', 'pending', 'confirming', 'paid', 'failed', 'expired'));
alter table public.orders drop constraint if exists orders_payment_check;
alter table public.orders add constraint orders_payment_check check (payment in ('cod', 'card', 'transfer', 'ecpay_card'));
create index if not exists orders_pay_group_idx on public.orders (pay_group_id) where pay_group_id is not null;

-- 賣家只看得到、改得到「不需付款」或「已付款」的訂單（R-B8）
drop policy if exists orders_read_own_shop on public.orders;
create policy orders_read_own_shop on public.orders for select to authenticated
  using (payment_status in ('none', 'paid')
         and exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()));
drop policy if exists orders_update_own_shop on public.orders;
create policy orders_update_own_shop on public.orders for update to authenticated
  using (payment_status in ('none', 'paid')
         and exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()))
  with check (payment_status in ('none', 'paid')
         and exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 庫存退回與訂單作廢
-- ═══════════════════════════════════════════════════════════════════════
-- 把一張線上付款訂單作廢：退回庫存、銷量扣回、狀態 cancelled。冪等：只處理 payment_status 是 pending／confirming 的。
-- 規格已被賣家刪除的品項略過（沒有東西可退）。回傳是否真的處理了。
create or replace function public._online_order_release(p_order uuid, p_payment_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  o   public.orders;
  l   jsonb;
  p   public.products;
  idx integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.payment_status not in ('pending', 'confirming') then return false; end if;
  for l in select * from jsonb_array_elements(o.lines) loop
    select * into p from public.products where id = (l->>'productId')::uuid for update;
    if not found then continue; end if;
    select ord - 1 into idx from jsonb_array_elements(p.variants) with ordinality t(value, ord) where value->>'id' = l->>'variantId';
    if idx is null then continue; end if;
    update public.products set
      variants = jsonb_set(variants, array[idx::text, 'stock'], to_jsonb(((variants->idx->>'stock')::integer + (l->>'qty')::integer))),
      sold = greatest(0, sold - (l->>'qty')::integer)
     where id = p.id;
  end loop;
  update public.orders set status = 'cancelled', payment_status = p_payment_status where id = p_order;
  return true;
end $$;
revoke all on function public._online_order_release(uuid, text) from public, anon, authenticated;

-- 一個群組全部作廢（逾時／次數用盡）。回傳處理的訂單數。只處理沒有在進行中的群組（呼叫端負責鎖）。
create or replace function public._expire_group(p_group uuid, p_group_status text, p_order_status text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.orders where pay_group_id = p_group and payment_status in ('pending', 'confirming') order by id loop
    if public._online_order_release(r.id, p_order_status) then n := n + 1; end if;
  end loop;
  update public.payment_groups set status = p_group_status, lease_until = null, updated_at = now() where id = p_group;
  return n;
end $$;
revoke all on function public._expire_group(uuid, text, text) from public, anon, authenticated;

-- 逾時（30 分鐘）的待付款群組：作廢並退庫存。進行中（processing／confirming）的群組不碰，等補償程序解決。
create or replace function public.expire_pending_online_orders(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare g record; n integer := 0;
begin
  for g in select id from public.payment_groups where status = 'pending' and expires_at <= now() order by expires_at limit p_limit for update skip locked loop
    n := n + public._expire_group(g.id, 'expired', 'expired');
  end loop;
  return n;
end $$;
revoke all on function public.expire_pending_online_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_pending_online_orders(integer) to service_role;

-- 買家在結帳頁倒數歸零時呼叫：只處理自己的逾時群組
create or replace function public.expire_my_pending_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid(); g record; n integer := 0;
begin
  for g in select id from public.payment_groups where user_id = v_uid and status = 'pending' and expires_at <= now() for update skip locked loop
    n := n + public._expire_group(g.id, 'expired', 'expired');
  end loop;
  return n;
end $$;
revoke all on function public.expire_my_pending_orders() from public;
grant execute on function public.expire_my_pending_orders() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. 下單：線上付款版（包裝 place_checked_order，比價與扣庫存的邏輯不重寫）
-- ═══════════════════════════════════════════════════════════════════════
-- p_online_shop_ids：這次要線上付款的店（JSON 陣列）；其餘的店照舊貨到付款（D24＝A：同一次送出）。
-- 回傳：rejected 時原樣回 place_checked_order 的結果；ok 時多帶 payGroupId、payTotal、expiresAt、onlineOrderIds，
--   orders[].payment 線上付款的那幾張是 'ecpay_card'。
create or replace function public.place_online_order(
  p_items jsonb, p_buyer jsonb, p_from_cart boolean default false, p_seen_shipping jsonb default null, p_online_shop_ids jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := public._acct_uid('請先登入再下單');
  v_online  uuid[] := '{}';
  v_e       jsonb;
  v_res     jsonb;
  v_group   uuid;
  v_ids     uuid[] := '{}';
  v_total   integer := 0;
  v_exp     timestamptz := now() + interval '30 minutes';
  v_o       public.orders;
  v_orders  jsonb := '[]'::jsonb;
  v_oid     uuid;
begin
  if not public._pay_enabled() then
    perform public._rv_raise('PAYMENT_DISABLED', '線上付款暫時無法使用，請改用貨到付款');
  end if;
  if p_online_shop_ids is null or jsonb_typeof(p_online_shop_ids) <> 'array' or jsonb_array_length(p_online_shop_ids) = 0 then
    perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
  end if;
  for v_e in select * from jsonb_array_elements(p_online_shop_ids) loop
    if jsonb_typeof(v_e) <> 'string' or (v_e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
    end if;
    v_online := v_online || (v_e #>> '{}')::uuid;
  end loop;
  -- 每一家都必須是已開通收款的店
  if exists (select 1 from unnest(v_online) s(id)
              where not exists (select 1 from public.seller_ecpay_merchants m where m.shop_id = s.id and m.status = 'active')) then
    perform public._rv_raise('SHOP_NOT_ONLINE', '有商店目前不能線上付款，請改用貨到付款');
  end if;

  v_res := public.place_checked_order(p_items, p_buyer, 'cod', p_from_cart, p_seen_shipping);
  if v_res->>'outcome' <> 'ok' then return v_res; end if;

  -- 線上付款的店必須真的在這次的訂單裡
  if exists (select 1 from unnest(v_online) s(id)
              where not exists (select 1 from jsonb_array_elements(v_res->'orders') e where (e->>'shop_id')::uuid = s.id)) then
    perform public._rv_raise('ITEM_INVALID', '資料有誤，請重新整理');
  end if;

  for v_e in select * from jsonb_array_elements(v_res->'orders') loop
    if (v_e->>'shop_id')::uuid = any (v_online) then
      if (v_e->>'total')::integer > 200000 then
        perform public._rv_raise('ONLINE_AMOUNT_LIMIT', '單一商店的線上付款金額上限為 200,000 元，請分開結帳或改用貨到付款');
      end if;
      v_ids := v_ids || (v_e->>'id')::uuid;
      v_total := v_total + (v_e->>'total')::integer;
    end if;
  end loop;

  insert into public.payment_groups (user_id, total, expires_at) values (v_uid, v_total, v_exp) returning id into v_group;
  update public.orders set payment = 'ecpay_card', payment_status = 'pending', pay_group_id = v_group, pay_expires_at = v_exp
   where id = any (v_ids);

  for v_oid in select (e->>'id')::uuid from jsonb_array_elements(v_res->'orders') e loop
    select * into v_o from public.orders where id = v_oid;
    v_orders := v_orders || to_jsonb((v_o.id, v_o.order_no, v_o.shop_id, v_o.lines, v_o.shipping_fee, v_o.total, v_o.status, v_o.payment,
      v_o.carrier, v_o.tracking_no, v_o.events, v_o.created_at)::public.buyer_order);
  end loop;
  return jsonb_build_object('outcome', 'ok', 'orders', v_orders, 'payGroupId', v_group, 'payTotal', v_total,
                            'expiresAt', v_exp, 'onlineOrderIds', to_jsonb(v_ids));
end $$;
revoke all on function public.place_online_order(jsonb, jsonb, boolean, jsonb, jsonb) from public;
grant execute on function public.place_online_order(jsonb, jsonb, boolean, jsonb, jsonb) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. 買家讀付款狀態
-- ═══════════════════════════════════════════════════════════════════════
-- 我所有線上付款訂單的付款資訊（不含貨到付款與歷史訂單）。前端把它跟 get_account_orders 的結果用 order_id 接起來。
create or replace function public.get_order_payments()
returns table (order_id uuid, group_id uuid, payment_status text, pay_expires_at timestamptz, paid_at timestamptz,
               card_brand text, card4 text, last_fail jsonb)
language sql stable security definer set search_path = public as $$
  select o.id, o.pay_group_id, o.payment_status, o.pay_expires_at, o.paid_at, o.pay_card_brand, o.pay_card4,
         case when o.payment_status in ('pending', 'failed') then g.last_fail else null end
    from public.orders o left join public.payment_groups g on g.id = o.pay_group_id
   where o.buyer_id = public._acct_uid() and o.payment_status <> 'none'
   order by o.created_at desc;
$$;
revoke all on function public.get_order_payments() from public;
grant execute on function public.get_order_payments() to anon, authenticated;

create or replace function public.get_payment_group(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid(); g public.payment_groups;
begin
  select * into g from public.payment_groups where id = p_group and user_id = v_uid;
  if not found then perform public._rv_raise('GROUP_NOT_FOUND', '找不到這筆付款'); end if;
  return jsonb_build_object('groupId', g.id, 'status', g.status, 'attemptNo', g.attempt_no, 'total', g.total,
    'expiresAt', g.expires_at, 'paidAt', g.paid_at, 'lastFail', g.last_fail,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('orderId', o.id, 'orderNo', o.order_no, 'shopId', o.shop_id, 'total', o.total,
                          'paymentStatus', o.payment_status, 'status', o.status) order by o.created_at, o.id)
                         from public.orders o where o.pay_group_id = g.id), '[]'::jsonb));
end $$;
revoke all on function public.get_payment_group(uuid) from public;
grant execute on function public.get_payment_group(uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. 取消訂單：線上付款的特別規則（取代 buyer_accounts_m1 的 cancel_account_order，簽名與回傳型別不變）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.cancel_account_order(p_id uuid)
returns public.buyer_order language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid();
  v_ps  text;
  v_g   uuid;
  v_gs  text;
  v_out public.buyer_order;
begin
  select o.payment_status, o.pay_group_id into v_ps, v_g from public.orders o where o.id = p_id and o.buyer_id = v_uid;
  if found and v_ps <> 'none' then
    if v_g is not null then select g.status into v_gs from public.payment_groups g where g.id = v_g for update; end if;
    -- 重新讀（拿到群組鎖之後的最新狀態）
    select o.payment_status into v_ps from public.orders o where o.id = p_id for update;
    if v_ps = 'paid' then
      perform public._rv_raise('ORDER_PAID_NO_CANCEL', '已付款的訂單不能自行取消，請聯絡賣家');
    elsif v_ps = 'confirming' or v_gs in ('processing', 'confirming') then
      perform public._rv_raise('PAYMENT_IN_PROGRESS', '付款確認中，請稍後再試');
    elsif v_ps = 'pending' then
      perform public._online_order_release(p_id, 'failed');
      if v_g is not null and not exists (select 1 from public.orders o where o.pay_group_id = v_g and o.payment_status = 'pending') then
        update public.payment_groups set status = 'cancelled', updated_at = now() where id = v_g and status = 'pending';
      end if;
      select o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment, o.carrier, o.tracking_no, o.events, o.created_at
        into v_out from public.orders o where o.id = p_id;
      return v_out;
    end if;
    perform public._rv_raise('ORDER_STATE_CHANGED', '訂單狀態已變更，請重新整理');
  end if;
  return public._account_order_transition(p_id, 'to_ship', 'cancelled');
end $$;
revoke all on function public.cancel_account_order(uuid) from public;
grant execute on function public.cancel_account_order(uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. 伺服器端專用（Edge Functions 用 service role 呼叫；錯誤用 jsonb {ok:false, code, message} 回傳，不 raise）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._rand_trade_no(p_prefix text) returns text
language sql volatile set search_path = public as $$
  select p_prefix || to_char(clock_timestamp() at time zone 'Asia/Taipei', 'YYMMDDHH24MISS') || substr(md5(random()::text || clock_timestamp()::text), 1, 20 - length(p_prefix) - 12);
$$;
revoke all on function public._rand_trade_no(text) from public, anon, authenticated;

-- 綁卡：開始。確保有會員編號、卡數未滿，建立一筆嘗試。
create or replace function public.bind_begin(p_user uuid, p_return_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_member text; v_no text;
begin
  if not public._pay_enabled() then return jsonb_build_object('ok', false, 'code', 'PAYMENT_DISABLED', 'message', '線上付款暫時無法使用'); end if;
  insert into public.payment_members (user_id) values (p_user) on conflict (user_id) do nothing;
  select merchant_member_id into v_member from public.payment_members where user_id = p_user;
  if (select count(*) from public.payment_methods where user_id = p_user) >= 5 then
    return jsonb_build_object('ok', false, 'code', 'CARD_LIMIT', 'message', '最多只能綁定 5 張信用卡，請先刪除一張');
  end if;
  -- 防濫用：每個帳號每小時最多開始 10 次綁卡（每次都會打一次綠界）
  if (select count(*) from public.ecpay_bind_attempts where user_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'BIND_RATE_LIMIT', 'message', '操作太頻繁，請稍後再試');
  end if;
  v_no := public._rand_trade_no('B');
  insert into public.ecpay_bind_attempts (merchant_trade_no, user_id, merchant_member_id, return_path) values (v_no, p_user, v_member, left(p_return_path, 200));
  return jsonb_build_object('ok', true, 'merchantTradeNo', v_no, 'memberId', v_member);
end $$;

-- 綁卡：成功。冪等（ReturnURL、OrderResultURL、查詢補償都可能各呼叫一次）。
create or replace function public.bind_apply_success(
  p_trade_no text, p_bind_card_id text, p_card6 text, p_card4 text, p_exp_year text, p_exp_month text, p_is_same boolean, p_ecpay_trade_no text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ecpay_bind_attempts; m_id uuid; v_dup boolean := false; v_first boolean;
begin
  select * into a from public.ecpay_bind_attempts where merchant_trade_no = p_trade_no for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ATTEMPT_NOT_FOUND', 'message', '找不到這次綁卡'); end if;
  if a.status = 'bound' then
    return jsonb_build_object('ok', true, 'already', true, 'paymentMethodId', a.payment_method_id, 'duplicate', coalesce(a.is_same_card, false), 'userId', a.user_id);
  end if;
  if a.user_id is null then return jsonb_build_object('ok', false, 'code', 'ATTEMPT_NOT_FOUND', 'message', '找不到這次綁卡'); end if;

  select id into m_id from public.payment_methods where user_id = a.user_id and bind_card_id = p_bind_card_id;
  if found then
    v_dup := true;
    update public.payment_methods set exp_year = p_exp_year, exp_month = p_exp_month, status = 'active', updated_at = now() where id = m_id;
  else
    v_first := not exists (select 1 from public.payment_methods where user_id = a.user_id and status = 'active');
    begin
      insert into public.payment_methods (user_id, bind_card_id, card6, card4, exp_month, exp_year, is_default)
      values (a.user_id, p_bind_card_id, p_card6, p_card4, p_exp_month, p_exp_year, v_first) returning id into m_id;
    exception when others then
      if sqlerrm like '%最多只能綁定 5 張%' then
        update public.ecpay_bind_attempts set status = 'failed', rtn_msg = 'card limit', void_state = 'pending', updated_at = now() where id = a.id;
        return jsonb_build_object('ok', false, 'code', 'CARD_LIMIT', 'message', '最多只能綁定 5 張信用卡，請先刪除一張', 'deleteBindCardId', p_bind_card_id, 'userId', a.user_id);
      end if;
      raise;
    end;
  end if;
  update public.ecpay_bind_attempts set status = 'bound', is_same_card = coalesce(p_is_same, v_dup) or v_dup, payment_method_id = m_id, rtn_code = 1,
    ecpay_trade_no = p_ecpay_trade_no, void_state = 'pending', updated_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'already', false, 'paymentMethodId', m_id, 'duplicate', v_dup or coalesce(p_is_same, false), 'userId', a.user_id);
end $$;

create or replace function public.bind_apply_failure(p_trade_no text, p_rtn_code integer, p_rtn_msg text)
returns void language sql security definer set search_path = public as $$
  update public.ecpay_bind_attempts set status = 'failed', rtn_code = p_rtn_code, rtn_msg = left(coalesce(p_rtn_msg, ''), 200), updated_at = now()
   where merchant_trade_no = p_trade_no and status in ('created', 'confirming');
$$;

-- 刪卡：先隱藏（revoking），預設那張在還有別張時不能刪（R-B5）
create or replace function public.method_begin_delete(p_user uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.payment_methods; v_member text; v_active integer;
begin
  select * into m from public.payment_methods where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'CARD_NOT_FOUND', 'message', '找不到這張卡'); end if;
  select merchant_member_id into v_member from public.payment_members where user_id = p_user;
  if m.status = 'revoking' then return jsonb_build_object('ok', true, 'bindCardId', m.bind_card_id, 'memberId', v_member); end if;
  select count(*) into v_active from public.payment_methods where user_id = p_user and status = 'active';
  if m.is_default and v_active > 1 then
    return jsonb_build_object('ok', false, 'code', 'DEFAULT_CARD_CANNOT_DELETE', 'message', '預設的卡不能直接刪除，請先把別張設為預設');
  end if;
  if exists (select 1 from public.payment_groups g where g.user_id = p_user and g.payment_method_id = p_id and g.status in ('processing', 'confirming')) then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_IN_PROGRESS', 'message', '這張卡正在付款中，請稍後再刪除');
  end if;
  update public.payment_methods set status = 'revoking', is_default = false, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'bindCardId', m.bind_card_id, 'memberId', v_member);
end $$;

create or replace function public.method_finish_delete(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.payment_methods where id = p_id and status = 'revoking';
$$;

-- 付款：開始一次嘗試。所有檢查與寫入在一個交易裡；回 {ok:false, code, message} 時什麼都沒改。
create or replace function public.pay_begin_attempt(p_group uuid, p_user uuid, p_method uuid, p_lease_seconds integer default 150)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.payment_groups; m public.payment_methods; r record; v_attempt integer; v_n integer := 0; v_member text;
begin
  select * into g from public.payment_groups where id = p_group for update;
  if not found or g.user_id is distinct from p_user then
    return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'message', '找不到這筆付款');
  end if;
  if not public._pay_enabled() then return jsonb_build_object('ok', false, 'code', 'PAYMENT_DISABLED', 'message', '線上付款暫時無法使用，請改用貨到付款'); end if;
  if g.status = 'paid' then return jsonb_build_object('ok', false, 'code', 'ALREADY_PAID', 'message', '這筆訂單已經付款完成'); end if;
  if g.status in ('processing', 'confirming') then return jsonb_build_object('ok', false, 'code', 'PAYMENT_IN_PROGRESS', 'message', '付款處理中，請稍候'); end if;
  if g.status in ('expired', 'failed', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'ORDER_EXPIRED', 'message', '這筆訂單已逾時或取消，請重新下單'); end if;
  if g.expires_at <= now() then
    perform public._expire_group(g.id, 'expired', 'expired');
    return jsonb_build_object('ok', false, 'code', 'ORDER_EXPIRED', 'message', '這筆訂單已逾時，請重新下單');
  end if;
  select * into m from public.payment_methods where id = p_method and user_id = p_user and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'code', 'CARD_NOT_FOUND', 'message', '找不到這張卡，請重新選擇'); end if;
  select merchant_member_id into v_member from public.payment_members where user_id = p_user;
  if v_member is null then return jsonb_build_object('ok', false, 'code', 'CARD_NOT_FOUND', 'message', '找不到這張卡，請重新選擇'); end if;

  v_attempt := g.attempt_no + 1;
  -- 先全部驗過再寫入：中途回 {ok:false} 時不能留下半套授權列
  for r in
    select o.id as order_id, o.shop_id, o.total, mm.status as mstatus
      from public.orders o left join public.seller_ecpay_merchants mm on mm.shop_id = o.shop_id
     where o.pay_group_id = p_group and o.payment_status = 'pending' order by o.created_at, o.id for update of o
  loop
    if r.mstatus is distinct from 'active' then
      return jsonb_build_object('ok', false, 'code', 'SHOP_NOT_ONLINE', 'message', '有商店目前不能線上付款', 'shopId', r.shop_id);
    end if;
    if r.total > 200000 then
      return jsonb_build_object('ok', false, 'code', 'ONLINE_AMOUNT_LIMIT', 'message', '單一商店的線上付款金額上限為 200,000 元', 'shopId', r.shop_id);
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    insert into public.payment_auths (group_id, order_id, shop_id, attempt_no, merchant_id, merchant_trade_no, amount)
    select p_group, o.id, o.shop_id, v_attempt, mm.ecpay_merchant_id, public._rand_trade_no('P'), o.total
      from public.orders o join public.seller_ecpay_merchants mm on mm.shop_id = o.shop_id
     where o.pay_group_id = p_group and o.payment_status = 'pending' order by o.created_at, o.id;
  end if;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'ORDER_EXPIRED', 'message', '這筆訂單已逾時或取消，請重新下單'); end if;

  update public.payment_groups set status = 'processing', decision = null, attempt_no = v_attempt, payment_method_id = p_method,
    lease_until = now() + make_interval(secs => p_lease_seconds), confirm_reason = null, updated_at = now() where id = p_group;
  return jsonb_build_object('ok', true, 'attemptNo', v_attempt, 'bindCardId', m.bind_card_id, 'memberId', v_member,
                            'cardBrand', (select brand from public.my_payment_methods_for(p_user) where id = m.id), 'card4', m.card4);
end $$;

-- view 只給前端；伺服器端要「某人的卡」用這個小工具（內部用，只給 pay_begin_attempt）
create or replace function public.my_payment_methods_for(p_user uuid)
returns table (id uuid, brand text) language sql stable security definer set search_path = public as $$
  select m.id, case when m.card6 like '4%' then 'visa' when m.card6 ~ '^(5[1-5]|2[2-7])' then 'mastercard' when m.card6 like '35%' then 'jcb'
                    when m.card6 like '62%' then 'unionpay' when m.card6 ~ '^3[47]' then 'amex' else 'other' end
    from public.payment_methods m where m.user_id = p_user;
$$;
revoke all on function public.my_payment_methods_for(uuid) from public, anon, authenticated;

create or replace function public.pay_finalize_paid(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.payment_groups; m public.payment_methods; v_bad integer;
begin
  select * into g from public.payment_groups where id = p_group for update;
  if not found then raise exception 'payment group not found: %', p_group; end if;
  if g.status = 'paid' then return; end if;
  select count(*) into v_bad from public.payment_auths a where a.group_id = p_group and a.attempt_no = g.attempt_no and a.state <> 'captured';
  if v_bad > 0 then raise exception 'cannot finalize paid: % authorizations are not captured', v_bad; end if;
  select * into m from public.payment_methods where id = g.payment_method_id;
  update public.orders o set payment_status = 'paid', paid_at = now(), ecpay_trade_no = a.ecpay_trade_no,
         pay_card_brand = (select brand from public.my_payment_methods_for(g.user_id) b where b.id = m.id), pay_card4 = m.card4
    from public.payment_auths a
   where a.group_id = p_group and a.attempt_no = g.attempt_no and a.order_id = o.id and o.payment_status in ('pending', 'confirming');
  update public.payment_groups set status = 'paid', paid_at = now(), lease_until = null, confirm_reason = null, updated_at = now() where id = p_group;
end $$;

create or replace function public.pay_finalize_failed(p_group uuid, p_fail jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare g public.payment_groups;
begin
  select * into g from public.payment_groups where id = p_group for update;
  if not found then raise exception 'payment group not found: %', p_group; end if;
  if g.status in ('paid', 'expired', 'failed', 'cancelled') then return g.status; end if;
  update public.payment_groups set last_fail = coalesce(p_fail, '{}'::jsonb) || jsonb_build_object('attemptNo', g.attempt_no, 'at', now()),
         lease_until = null, confirm_reason = null, updated_at = now() where id = p_group;
  update public.orders set payment_status = 'pending' where pay_group_id = p_group and payment_status = 'confirming';
  if g.attempt_no >= 5 then
    -- 失敗五次：訂單作廢、庫存退回（買家要重新下單）
    perform public._expire_group(p_group, 'failed', 'failed');
    return 'failed';
  end if;
  update public.payment_groups set status = 'pending' where id = p_group;
  return 'pending';
end $$;

create or replace function public.pay_set_confirming(p_group uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payment_groups set status = 'confirming', confirm_reason = left(p_reason, 60), lease_until = null, updated_at = now()
   where id = p_group and status in ('processing', 'confirming');
  update public.orders set payment_status = 'confirming' where pay_group_id = p_group and payment_status = 'pending'
     and exists (select 1 from public.payment_groups g where g.id = p_group and g.status = 'confirming');
end $$;

-- 補償：搶租約。confirming 且沒人處理，或 processing 但原本那個請求已經死了（租約過期）。
create or replace function public.pay_claim_for_resolve(p_group uuid, p_user uuid, p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.payment_groups set status = 'confirming', lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_group and (p_user is null or user_id = p_user)
     and ((status = 'confirming' and (lease_until is null or lease_until < now())) or (status = 'processing' and lease_until < now()))
  returning id into v_id;
  if v_id is null then return false; end if;
  update public.orders set payment_status = 'confirming' where pay_group_id = p_group and payment_status = 'pending';
  return true;
end $$;

create or replace function public.pay_list_resolvable(p_limit integer default 50) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.payment_groups
   where (status = 'confirming' and (lease_until is null or lease_until < now())) or (status = 'processing' and lease_until < now())
   order by updated_at limit p_limit;
$$;

-- 授權給前端／Edge Function 的最小單位（目前這次嘗試）
create or replace function public.pay_group_context(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('userId', g.user_id, 'status', g.status, 'decision', g.decision, 'attemptNo', g.attempt_no,
    'bindCardId', m.bind_card_id, 'memberId', pm.merchant_member_id, 'orderNos', coalesce((select jsonb_agg(o.order_no order by o.created_at, o.id) from public.orders o where o.pay_group_id = g.id), '[]'::jsonb))
    from public.payment_groups g
    left join public.payment_methods m on m.id = g.payment_method_id
    left join public.payment_members pm on pm.user_id = g.user_id
   where g.id = p_group;
$$;

-- 權限：以上全部只給 service_role
do $$
declare f text;
begin
  foreach f in array array[
    'bind_begin(uuid,text)', 'bind_apply_success(text,text,text,text,text,text,boolean,text)', 'bind_apply_failure(text,integer,text)',
    'method_begin_delete(uuid,uuid)', 'method_finish_delete(uuid)', 'pay_begin_attempt(uuid,uuid,uuid,integer)',
    'pay_finalize_paid(uuid)', 'pay_finalize_failed(uuid,jsonb)', 'pay_set_confirming(uuid,text)',
    'pay_claim_for_resolve(uuid,uuid,integer)', 'pay_list_resolvable(integer)', 'pay_group_context(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. 自我檢查：權限不如預期就整個回滾
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  r text; t text; p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    -- 這些表任何人都不能直接碰（含 BindCardID 所在的 payment_methods）
    foreach t in array array['payment_config', 'payment_members', 'payment_methods', 'ecpay_bind_attempts', 'payment_groups', 'payment_auths'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) then
          raise exception '付款自我檢查失敗：% 對 % 有 % 權限，整個交易回滾', r, t, p;
        end if;
      end loop;
    end loop;
    if has_column_privilege(r, 'public.payment_methods', 'bind_card_id', 'select') then
      raise exception '付款自我檢查失敗：% 讀得到 bind_card_id，整個交易回滾', r;
    end if;
    -- orders 新欄位前端讀不到、改不到
    foreach t in array array['payment_status', 'ecpay_trade_no', 'paid_at', 'pay_group_id', 'pay_expires_at', 'pay_card_brand', 'pay_card4'] loop
      if has_column_privilege(r, 'public.orders', t, 'select') or has_column_privilege(r, 'public.orders', t, 'update') then
        raise exception '付款自我檢查失敗：% 對 orders.% 有權限，整個交易回滾', r, t;
      end if;
    end loop;
    -- 伺服器專用函式不開放
    foreach t in array array['pay_begin_attempt(uuid,uuid,uuid,integer)', 'pay_finalize_paid(uuid)', 'bind_begin(uuid,text)', 'method_begin_delete(uuid,uuid)',
                             'expire_pending_online_orders(integer)', 'pay_group_context(uuid)', '_online_order_release(uuid,text)', 'my_payment_methods_for(uuid)'] loop
      if has_function_privilege(r, 'public.' || t, 'execute') then
        raise exception '付款自我檢查失敗：% 可以執行 %，整個交易回滾', r, t;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role', 'public.pay_begin_attempt(uuid,uuid,uuid,integer)', 'execute') then
    raise exception '付款自我檢查失敗：service_role 不能執行 pay_begin_attempt，整個交易回滾';
  end if;
  if not has_table_privilege('authenticated', 'public.my_payment_methods', 'select') then
    raise exception '付款自我檢查失敗：authenticated 讀不到 my_payment_methods，整個交易回滾';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'my_payment_methods' and column_name = 'bind_card_id') then
    raise exception '付款自我檢查失敗：my_payment_methods 含 bind_card_id，整個交易回滾';
  end if;
  foreach t in array array['place_online_order', 'cancel_account_order', 'get_order_payments', 'get_payment_group', 'set_default_payment_method', 'get_payment_config', 'expire_my_pending_orders'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = t) <> 1 then
      raise exception '付款自我檢查失敗：% 有多載（PostgREST 會 PGRST203），整個交易回滾', t;
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
