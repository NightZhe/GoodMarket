-- 付款改進平台帳戶（PR-乙，.work/platform-collect/spec.md v0.1；decisions E1～E4、甲 Q3＝B／N1＝A／N4＝A）
--
-- 只做相容的新增與 create or replace，不改任何既有欄位的語意；整個檔案一個交易、可重複執行（開關開著時重套也不會改動開關值與打開時間）、末尾自我檢查。
--   · payment_config 加兩欄：platform_collect_enabled（平台收款開關，預設關）、platform_collect_enabled_at（最近一次打開的時間；關掉不清）。
--   · 新 helper _platform_collect_enabled()；維運函式 admin_set_platform_collect(boolean)（只給 service_role）。
--   · get_payment_config() 多回 platformCollectEnabled／platformCollectEnabledAt（舊欄位 onlinePaymentEnabled 不變，AC-61）。
--   · 單一規則函式 _shop_online_payable(uuid)：線上付款開關開 且 平台收款開關開 且 店主有撥款帳號（甲的 _shop_has_payout_account，N4）。
--     三處判斷（get_shops_online_payable、place_online_order、pay_begin_attempt）都只呼叫它；seller_ecpay_merchants.status='active' 不再是條件（IN-B1／IN-B2）。
--     → 開關關著時任何店都不能線上付款，與正式站現況（0 家 active）相同（AC-50）。
--   · payment_auths 加 collector（'seller'＝刷進賣家特店（既有列）、'platform'＝刷進本站商店編號；S-2）。
--   · pay_begin_attempt 多一個參數 p_collect_merchant_id（本站收款商店編號由 Edge Function secret 傳入，不存資料庫）；舊簽名 drop，不留多載。
--     merchant_id 快照＝該參數、collector='platform'；退款（order_refunds.merchant_id）沿用既有快照邏輯，不改。
--   · get_seller_order_payouts 多回 collector（既有欄位不動；賣家訂單頁 IN-B7 據此切換）。回傳型別變了所以 drop 再 create，權限重新給。
-- 不動：seller_ecpay_merchants 表與 submit_seller_ecpay_merchant（OUT-18）、_payout_view／_payout_merchants（OUT-9）、退款函式。
-- 錯誤格式沿用 _rv_raise：message＝中文、hint＝錯誤碼；錯誤碼集合不變（SHOP_NOT_ONLINE、PAYMENT_DISABLED…）。
begin;

do $$
begin
  if to_regclass('public.payment_config') is null or to_regclass('public.payment_auths') is null then
    raise exception '請先套 20261019200000_ecpay_payments.sql（找不到 payment_config／payment_auths），整個交易回滾';
  end if;
  if to_regprocedure('public._shop_has_payout_account(uuid)') is null then
    raise exception '請先套 20261029120000_bank_accounts.sql（找不到 _shop_has_payout_account），整個交易回滾';
  end if;
  if to_regprocedure('public.get_seller_order_payouts(uuid[])') is null then
    raise exception '請先套 20261020140000_payout_reconcile.sql（找不到 get_seller_order_payouts），整個交易回滾';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 平台收款開關（預設關；E4＝A）
-- ═══════════════════════════════════════════════════════════════════════
alter table public.payment_config add column if not exists platform_collect_enabled boolean not null default false;
alter table public.payment_config add column if not exists platform_collect_enabled_at timestamptz;

create or replace function public._platform_collect_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select platform_collect_enabled from public.payment_config where id), false);
$$;
revoke all on function public._platform_collect_enabled() from public, anon, authenticated;

-- 維運：開／關平台收款（runbook 用；只給 service_role）。打開時記時間，關掉不清（S-3、E6）。回新的 get_payment_config()。
create or replace function public.admin_set_platform_collect(p_enabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_enabled is null then raise exception 'p_enabled 不可為 null'; end if;
  update public.payment_config
     set platform_collect_enabled = p_enabled,
         platform_collect_enabled_at = case when p_enabled then now() else platform_collect_enabled_at end,
         updated_at = now()
   where id;
  if not found then raise exception 'payment_config 沒有那一列'; end if;
  return public.get_payment_config();
end $$;
revoke all on function public.admin_set_platform_collect(boolean) from public, anon, authenticated;
grant execute on function public.admin_set_platform_collect(boolean) to service_role;

-- 前端讀開關：舊欄位不變，多兩欄（S-1、AC-61）。不回任何商店編號或金鑰。
create or replace function public.get_payment_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'onlinePaymentEnabled', public._pay_enabled(),
    'platformCollectEnabled', public._platform_collect_enabled(),
    'platformCollectEnabledAt', (select c.platform_collect_enabled_at from public.payment_config c where c.id));
$$;
revoke all on function public.get_payment_config() from public;
grant execute on function public.get_payment_config() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 單一規則：這家店現在能不能線上付款（IN-B2；三處都只呼叫這一支，AC-52）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._shop_online_payable(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._pay_enabled() and public._platform_collect_enabled() and public._shop_has_payout_account(p_shop_id);
$$;
revoke all on function public._shop_online_payable(uuid) from public, anon, authenticated;
grant execute on function public._shop_online_payable(uuid) to service_role;

-- 2a. 結帳頁問：這幾家店能不能線上付款（簽名、回傳、權限不變）
create or replace function public.get_shops_online_payable(p_shop_ids uuid[])
returns table (shop_id uuid, online_payable boolean)
language sql stable security definer set search_path = public as $$
  select s.id, public._shop_online_payable(s.id)
    from public.shops s
   where s.id = any (coalesce(p_shop_ids, '{}'));
$$;
revoke all on function public.get_shops_online_payable(uuid[]) from public;
grant execute on function public.get_shops_online_payable(uuid[]) to anon, authenticated;

-- 2b. 下單（整支照 20261019200000 的 place_online_order，只把「每家店必須是 active 特約商店」換成單一規則）
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
  -- 每一家都必須現在能線上付款（單一規則：開關＋店主有撥款帳號；IN-B2）
  if exists (select 1 from unnest(v_online) s(id) where not public._shop_online_payable(s.id)) then
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
-- 3. 授權快照：刷進誰（S-2）
-- ═══════════════════════════════════════════════════════════════════════
alter table public.payment_auths add column if not exists collector text not null default 'seller';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_auths_collector_check') then
    alter table public.payment_auths add constraint payment_auths_collector_check check (collector in ('seller', 'platform'));
  end if;
end $$;

-- 2c. 付款：開始一次嘗試。所有檢查與寫入在一個交易裡；回 {ok:false, code, message} 時什麼都沒改。
-- 相對 20261019200000：多 p_collect_merchant_id（本站收款商店編號，Edge Function 從 secret 讀來傳入）；每張訂單的店改用單一規則判斷；
-- 授權列 merchant_id＝p_collect_merchant_id、collector='platform'。舊簽名 drop（不留多載，PostgREST PGRST203）。
drop function if exists public.pay_begin_attempt(uuid, uuid, uuid, integer);
create or replace function public.pay_begin_attempt(p_group uuid, p_user uuid, p_method uuid, p_collect_merchant_id text, p_lease_seconds integer default 150)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.payment_groups; m public.payment_methods; r record; v_attempt integer; v_n integer := 0; v_member text;
begin
  select * into g from public.payment_groups where id = p_group for update;
  if not found or g.user_id is distinct from p_user then
    return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'message', '找不到這筆付款');
  end if;
  if not public._pay_enabled() or not public._platform_collect_enabled() then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_DISABLED', 'message', '線上付款暫時無法使用，請改用貨到付款');
  end if;
  -- 本站收款商店編號沒設或格式不對：不能刷進任何地方，當作停用（E1 fail closed 的資料庫這一側）
  if p_collect_merchant_id is null or p_collect_merchant_id !~ '^[0-9]{7,10}$' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_DISABLED', 'message', '線上付款暫時無法使用，請改用貨到付款');
  end if;
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
    select o.id as order_id, o.shop_id, o.total
      from public.orders o
     where o.pay_group_id = p_group and o.payment_status = 'pending' order by o.created_at, o.id for update of o
  loop
    if not public._shop_online_payable(r.shop_id) then
      return jsonb_build_object('ok', false, 'code', 'SHOP_NOT_ONLINE', 'message', '有商店目前不能線上付款', 'shopId', r.shop_id);
    end if;
    if r.total > 200000 then
      return jsonb_build_object('ok', false, 'code', 'ONLINE_AMOUNT_LIMIT', 'message', '單一商店的線上付款金額上限為 200,000 元', 'shopId', r.shop_id);
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    insert into public.payment_auths (group_id, order_id, shop_id, attempt_no, merchant_id, merchant_trade_no, amount, collector)
    select p_group, o.id, o.shop_id, v_attempt, p_collect_merchant_id, public._rand_trade_no('P'), o.total, 'platform'
      from public.orders o
     where o.pay_group_id = p_group and o.payment_status = 'pending' order by o.created_at, o.id;
  end if;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'ORDER_EXPIRED', 'message', '這筆訂單已逾時或取消，請重新下單'); end if;

  update public.payment_groups set status = 'processing', decision = null, attempt_no = v_attempt, payment_method_id = p_method,
    lease_until = now() + make_interval(secs => p_lease_seconds), confirm_reason = null, updated_at = now() where id = p_group;
  return jsonb_build_object('ok', true, 'attemptNo', v_attempt, 'bindCardId', m.bind_card_id, 'memberId', v_member,
                            'cardBrand', (select brand from public.my_payment_methods_for(p_user) where id = m.id), 'card4', m.card4);
end $$;
revoke all on function public.pay_begin_attempt(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.pay_begin_attempt(uuid, uuid, uuid, text, integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 賣家訂單頁：撥款狀態多回「刷進誰」（IN-B7）
-- ═══════════════════════════════════════════════════════════════════════
-- 既有欄位與語意完全不動（_payout_view 不改）；最後多一欄 collector：這張單最近一次請款成功的授權刷進誰（'seller'｜'platform'；找不到授權＝'seller'）。
-- 回傳型別變了，create or replace 不能改，所以 drop 再 create，權限重新給。
drop function if exists public.get_seller_order_payouts(uuid[]);
create function public.get_seller_order_payouts(p_order_ids uuid[])
returns table (order_id uuid, payout_status text, expected_payout_date date, paid_out_date date, payout_amount integer, fee_amount integer,
               clawback_amount integer, clawback_date date, data_updated_at timestamptz, has_ledger_rows boolean, collector text)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if coalesce(cardinality(p_order_ids), 0) > 200 then perform public._rv_raise('TOO_MANY_IDS', '一次最多查 200 張訂單'); end if;
  return query
    select v.*,
           coalesce((select a.collector from public.payment_auths a where a.order_id = o.id and a.state = 'captured'
                      order by a.updated_at desc nulls last, a.attempt_no desc limit 1), 'seller') as collector
      from public.orders o
      join public.shops s on s.id = o.shop_id and s.owner_id = v_uid
      cross join lateral public._payout_view(o.id, now()) v
     where o.id = any (p_order_ids) and o.payment = 'ecpay_card' and o.payment_status in ('paid', 'refunding', 'refunded')
     order by o.created_at desc, o.id;
end $$;
revoke all on function public.get_seller_order_payouts(uuid[]) from public;
grant execute on function public.get_seller_order_payouts(uuid[]) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 自我檢查：權限或多載不如預期就整個回滾
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r text; t text; p text;
begin
  -- 開關欄位要存在、預設 false（不檢查目前的值：開關打開後重套本檔也要能過，而且不得改動開關值與打開時間；AC-62）
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_config'
                  and column_name = 'platform_collect_enabled' and is_nullable = 'NO' and column_default = 'false') then
    raise exception '平台收款自我檢查失敗：payment_config.platform_collect_enabled 不是 not null default false，整個交易回滾';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_config' and column_name = 'platform_collect_enabled_at') then
    raise exception '平台收款自我檢查失敗：payment_config.platform_collect_enabled_at 不存在，整個交易回滾';
  end if;
  -- 賣家訂單頁的撥款 RPC 重建後，回傳欄位仍不得含商店編號與交易編號（D42＝C；AC-61 的精神）
  if pg_get_function_result(to_regprocedure('public.get_seller_order_payouts(uuid[])')) ~ '(merchant_id|merchant_trade_no|ecpay_trade_no)' then
    raise exception '平台收款自我檢查失敗：get_seller_order_payouts 回傳了商店編號或交易編號，整個交易回滾';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege(r, 'public.payment_config', p) or has_table_privilege(r, 'public.payment_auths', p) then
        raise exception '平台收款自我檢查失敗：% 對 payment_config／payment_auths 有 % 權限，整個交易回滾', r, p;
      end if;
    end loop;
    foreach t in array array['_platform_collect_enabled()', 'admin_set_platform_collect(boolean)', '_shop_online_payable(uuid)',
                             'pay_begin_attempt(uuid,uuid,uuid,text,integer)', '_shop_has_payout_account(uuid)'] loop
      if has_function_privilege(r, 'public.' || t, 'execute') then
        raise exception '平台收款自我檢查失敗：% 可以執行 %，整個交易回滾', r, t;
      end if;
    end loop;
    foreach t in array array['get_payment_config()', 'get_shops_online_payable(uuid[])', 'place_online_order(jsonb,jsonb,boolean,jsonb,jsonb)', 'get_seller_order_payouts(uuid[])'] loop
      if not has_function_privilege(r, 'public.' || t, 'execute') then
        raise exception '平台收款自我檢查失敗：% 不能執行 %，整個交易回滾', r, t;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role', 'public.pay_begin_attempt(uuid,uuid,uuid,text,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_set_platform_collect(boolean)', 'execute') then
    raise exception '平台收款自我檢查失敗：service_role 缺執行權限，整個交易回滾';
  end if;
  foreach t in array array['pay_begin_attempt', 'get_seller_order_payouts', 'get_payment_config', 'get_shops_online_payable', 'place_online_order', 'admin_set_platform_collect', '_shop_online_payable'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = t) <> 1 then
      raise exception '平台收款自我檢查失敗：% 有多載（PostgREST 會 PGRST203），整個交易回滾', t;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_auths' and column_name = 'collector') then
    raise exception '平台收款自我檢查失敗：payment_auths.collector 不存在，整個交易回滾';
  end if;
  if exists (select 1 from public.payment_auths where collector not in ('seller', 'platform')) then
    raise exception '平台收款自我檢查失敗：collector 有非法值，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
