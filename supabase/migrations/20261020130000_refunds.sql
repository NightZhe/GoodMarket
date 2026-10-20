-- 已付款線上訂單的取消與退款（.work/account-payment-methods/spec-refund.md 工單 RF-B1；decisions.md D26＝B、D27＝A（48 小時）、D28～D32＝A，第七輪補充）
--
-- 前提：已套 20261019200000_ecpay_payments.sql（沒套會直接中止，不做任何事）。
-- 相容的新增，加上一道「收緊」（R-RF5）：
--   · orders.payment_status 多兩個值：refunding（退款處理中）、refunded（已退款）。
--   · 新表 order_cancel_requests（買家的取消申請，每張訂單最多一筆＝只能申請一次，D32）、
--     order_refunds（退款紀錄，每張訂單最多一筆，R-RF6）。兩張都開 RLS，anon／authenticated 沒有任何權限，只能經由 RPC 讀。
--     兩張都**沒有**指向 auth.users 的外鍵：買家刪帳號時訂單的 buyer_id 變 null、退款紀錄留著（R-RF15），
--     刪帳號工具認得的外鍵集合（buyer-auth/tools/account-tool.mjs 的 KNOWN_FK）也不變。
--   · orders 的 before update trigger orders_guard_payment（**收緊**）：
--       R-RF5  已付款的線上訂單只能經由本檔的函式改成已取消（同時變 refunding、而且要先有退款紀錄）；店主直接 UPDATE、
--              手動 SQL（含 service_role／postgres）一律拒絕，訊息「已付款的訂單請用『取消並退款』」。貨到付款訂單不受影響。
--       R-RF10 有申請中的取消申請時不能出貨（status → shipping）。
--       §11.1  refunded 是終點；refunding 只能往 refunded；進入 refunding／refunded 要有對應狀態的退款紀錄。
--   · 賣家讀訂單的 policy 放寬到 refunding／refunded（賣家看得到已取消、退款中、已退款的單，C-2）；改訂單的 policy 不放寬。
--   · 前端 RPC（anon＋authenticated 可執行，沒登入回 NOT_AUTHENTICATED）：request_order_cancel、withdraw_order_cancel、
--     respond_order_cancel、seller_cancel_paid_order、get_my_order_refunds、get_shop_order_refunds、get_shop_cancel_summary。
--   · 伺服器端專用（只有 service_role）：refund_list_due、refund_claim、refund_record、refund_auto_accept_due（payment-sweep 用）、
--     ops_retry_refund、ops_mark_refund_done_manually（維運，prod-runbook-pb.md §10.3）。
-- 錯誤格式沿用 _rv_raise：message＝中文、hint＝錯誤碼。介面見 .work/account-payment-methods/interface-payment.md 第 8 節「退款」。
-- 可重複執行；整個檔案一個交易。回滾：.work/account-payment-methods/tools/pb/rollback-refunds.sql（有任何退款資料時會中止）。
begin;

do $$
begin
  if to_regclass('public.payment_auths') is null or to_regclass('public.payment_groups') is null then
    raise exception '請先套 20261019200000_ecpay_payments.sql（找不到 payment_auths／payment_groups），整個交易回滾';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. payment_status 多兩個值
-- ═══════════════════════════════════════════════════════════════════════
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('none', 'pending', 'confirming', 'paid', 'failed', 'expired', 'refunding', 'refunded'));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 取消申請（買家）與退款紀錄
-- ═══════════════════════════════════════════════════════════════════════
-- 原因代碼（畫面文字在 design-refund.md §4.3；代碼不給人看）
--   買家：no_longer_wanted 不想買了／change_item 想更換商品或規格／duplicate_order 重複下單／seller_too_slow 賣家太久沒出貨／other 其他
--   賣家：out_of_stock 缺貨或無法出貨／buyer_asked 買家要求取消／listing_error 價格或商品資訊有誤／other 其他
create table if not exists public.order_cancel_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders(id) on delete cascade,   -- unique：每張訂單只能申請一次（D32＝A）
  reason        text not null check (reason in ('no_longer_wanted', 'change_item', 'duplicate_order', 'seller_too_slow', 'other')),
  note          text check (note is null or char_length(note) between 1 and 100),
  status        text not null default 'pending' check (status in ('pending', 'withdrawn', 'accepted', 'rejected', 'auto_accepted')),
  requested_at  timestamptz not null default now(),
  respond_by    timestamptz not null,                                                  -- 申請時間＋48 小時（D27＝A）
  decided_at    timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) between 1 and 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'rejected') = (reject_reason is not null))
);
create index if not exists order_cancel_requests_due_idx on public.order_cancel_requests (respond_by) where status = 'pending';
alter table public.order_cancel_requests enable row level security;
revoke all on public.order_cancel_requests from public, anon, authenticated;

-- 退款紀錄：財務紀錄。訂單被刪（賣家刪帳號 → 店 → 訂單 cascade）時 order_id 變 null，其餘快照留著（同 payment_auths 的做法）。
create table if not exists public.order_refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid unique references public.orders(id) on delete set null,          -- unique：每張訂單最多一筆退款（R-RF6）
  order_no           text not null,
  shop_id            uuid not null,
  auth_id            uuid references public.payment_auths(id),
  merchant_id        text not null,                                                        -- 綠界特約商店編號（快照；只有 service_role 讀得到）
  merchant_trade_no  text not null,
  initiated_by       text not null check (initiated_by in ('buyer', 'seller', 'auto', 'ops')),  -- buyer＝買家申請、賣家同意；auto＝逾時自動同意
  reason             text,                                                                 -- 給對方看的原因代碼（buyer／auto＝買家申請的原因；seller＝賣家選的）
  note               text,
  amount             integer not null check (amount > 0),                                  -- 全額＝該筆授權金額＝訂單總額含運費（R-RF4）
  status             text not null default 'refunding' check (status in ('refunding', 'refunded')),
  method             text check (method in ('void', 'card_refund', 'manual')),           -- void＝取消授權；card_refund＝退刷；manual＝維運人工完成
  manual_action      text check (manual_action in ('void', 'card_refund')),              -- 人工完成時，維運在綠界後台實際做的是哪一種
  started_at         timestamptz not null default now(),                                   -- 進入退款處理中的時間
  refunded_at        timestamptz,
  attempts           integer not null default 0,
  next_attempt_at    timestamptz not null default now(),
  lease_until        timestamptz,
  last_action        text,
  last_rtn_code      integer,
  last_rtn_msg       text,                                                                 -- 綠界回應原文：只給維運看
  last_ecpay_status  text,
  last_attempt_at    timestamptz,
  needs_manual_since timestamptz,
  manual_hint        text check (manual_hint in ('balance', 'other')),
  retry_from         timestamptz,                                                          -- 維運按重試的時間：36 小時從這裡重算
  ops_note           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((status = 'refunded') = (refunded_at is not null and method is not null)),
  check ((method = 'manual') = (manual_action is not null)),
  check (needs_manual_since is null or manual_hint is not null)
);
create index if not exists order_refunds_due_idx on public.order_refunds (next_attempt_at) where status = 'refunding' and needs_manual_since is null;
alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 守門員（收緊）：任何路徑改 orders 都要通過
-- ═══════════════════════════════════════════════════════════════════════
-- security definer：店主直接 UPDATE 時以店主身分觸發，店主讀不到 order_refunds／order_cancel_requests。
-- 觸發順序：同一時機的 BEFORE trigger 依名稱字母序，orders_guard_payment 排在 orders_guard_status 前面，所以 R-RF5 的中文訊息先出來。
create or replace function public._orders_guard_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  -- R-RF5：已付款線上單變成已取消時，付款狀態必須同時變成退款處理中（只有本檔的函式會這樣寫）
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and old.payment_status = 'paid'
     and new.payment_status is distinct from 'refunding' then
    raise exception '已付款的訂單請用「取消並退款」' using hint = 'PAID_ORDER_USE_REFUND';
  end if;
  -- R-RF10：申請中的取消申請要先回應，才能出貨
  if new.status = 'shipping' and old.status is distinct from 'shipping'
     and exists (select 1 from public.order_cancel_requests r where r.order_id = new.id and r.status = 'pending') then
    raise exception '買家申請取消中，請先同意或拒絕，才能安排出貨' using hint = 'CANCEL_REQUEST_PENDING';
  end if;

  if new.payment_status is not distinct from old.payment_status then return new; end if;
  -- §11.1：refunded 是終點；refunding 只能往 refunded
  if old.payment_status = 'refunded' then
    raise exception '已退款的訂單不能再改付款狀態' using hint = 'REFUND_FINAL';
  end if;
  if old.payment_status = 'refunding' and new.payment_status <> 'refunded' then
    raise exception '退款處理中的訂單只能改成已退款' using hint = 'REFUND_IN_PROGRESS';
  end if;
  if new.payment_status in ('refunding', 'refunded') then
    if old.payment_status not in ('paid', 'refunding') then
      raise exception '只有已付款的訂單能退款' using hint = 'ORDER_NOT_PAID';
    end if;
    select f.status into v_ref from public.order_refunds f where f.order_id = new.id;
    if v_ref is null or v_ref <> new.payment_status then
      raise exception '沒有對應的退款紀錄，不能改成退款狀態（請用退款函式）' using hint = 'REFUND_RECORD_REQUIRED';
    end if;
    if new.payment_status = 'refunding' and new.status <> 'cancelled' then
      raise exception '退款處理中的訂單必須是已取消' using hint = 'ORDER_STATE_CHANGED';
    end if;
    -- 已付款直接變已退款：只有維運對齊「運送中／已完成」的訂單（D28＝A，ops_mark_refund_done_manually）
    if old.payment_status = 'paid' and new.payment_status = 'refunded' and new.status not in ('shipping', 'completed') then
      raise exception '待出貨的已付款訂單請用「取消並退款」' using hint = 'PAID_ORDER_USE_REFUND';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._orders_guard_payment() from public, anon, authenticated;
drop trigger if exists orders_guard_payment on public.orders;
create trigger orders_guard_payment before update on public.orders for each row execute function public._orders_guard_payment();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 賣家讀訂單：看得到退款中、已退款（改訂單的 policy 不動）
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists orders_read_own_shop on public.orders;
create policy orders_read_own_shop on public.orders for select to authenticated
  using (payment_status in ('none', 'paid', 'refunding', 'refunded')
         and exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 內部工具
-- ═══════════════════════════════════════════════════════════════════════
-- 退回庫存、銷量扣回（D31＝A）。規格已被刪除的品項略過（同 _online_order_release）。不改訂單狀態。
create or replace function public._order_restock(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; l jsonb; p public.products; idx integer;
begin
  select * into o from public.orders where id = p_order;
  for l in select * from jsonb_array_elements(o.lines) loop
    select * into p from public.products where id = (l->>'productId')::uuid for update;
    if not found then continue; end if;
    idx := null;
    select ord - 1 into idx from jsonb_array_elements(p.variants) with ordinality t(value, ord) where value->>'id' = l->>'variantId';
    if idx is null then continue; end if;
    update public.products set
      variants = jsonb_set(variants, array[idx::text, 'stock'], to_jsonb(((variants->idx->>'stock')::integer + (l->>'qty')::integer))),
      sold = greatest(0, sold - (l->>'qty')::integer)
     where id = p.id;
  end loop;
end $$;

-- 已付款、待出貨的線上單 → 已取消＋退款處理中：同一個交易寫退款紀錄、退庫存、改訂單（§6.2 第 1 點）。
create or replace function public._paid_order_cancel(p_order uuid, p_by text, p_reason text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.orders; a public.payment_auths; v_id uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.payment <> 'ecpay_card' or o.payment_status <> 'paid' or o.status <> 'to_ship' then
    perform public._rv_raise('ORDER_STATE_CHANGED', '訂單狀態已變更，請重新整理');
  end if;
  select * into a from public.payment_auths
   where order_id = o.id and group_id = o.pay_group_id and state = 'captured'
   order by attempt_no desc, created_at desc limit 1;
  if not found then
    raise exception '找不到這張訂單已請款的綠界授權（資料不一致，請聯絡維運）' using hint = 'PAYMENT_AUTH_MISSING';
  end if;
  insert into public.order_refunds (order_id, order_no, shop_id, auth_id, merchant_id, merchant_trade_no, initiated_by, reason, note, amount)
  values (o.id, o.order_no, o.shop_id, a.id, a.merchant_id, a.merchant_trade_no, p_by, p_reason, p_note, a.amount)
  returning id into v_id;
  perform public._order_restock(o.id);
  update public.orders set status = 'cancelled', payment_status = 'refunding' where id = o.id;
  return v_id;
end $$;

-- 去頭尾空白；空字串 → null
create or replace function public._refund_text(p text) returns text
language sql immutable set search_path = public as $$ select nullif(public._rv_trim(coalesce(p, '')), ''); $$;

-- 買家：鎖住自己的訂單（別人的一律 ORDER_NOT_FOUND，不洩漏是否存在）
create or replace function public._buyer_order_locked(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; v_uid uuid := public._acct_uid();
begin
  select * into o from public.orders where id = p_order and buyer_id = v_uid for update;
  if not found then perform public._rv_raise('ORDER_NOT_FOUND', '找不到這筆訂單'); end if;
  return o;
end $$;

-- 賣家：鎖住自己店、而且賣家看得到的訂單（待付款等看不到的狀態也回 ORDER_NOT_FOUND）
create or replace function public._seller_order_locked(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; v_uid uuid := public._acct_uid();
begin
  select * into o from public.orders
   where id = p_order and payment_status in ('none', 'paid', 'refunding', 'refunded')
     and exists (select 1 from public.shops s where s.id = orders.shop_id and s.owner_id = v_uid)
   for update;
  if not found then perform public._rv_raise('ORDER_NOT_FOUND', '找不到這筆訂單'); end if;
  return o;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 前端 RPC：寫入
-- ═══════════════════════════════════════════════════════════════════════
-- 買家申請取消（D26＝B）。回 {outcome:'requested', respondBy}
create or replace function public.request_order_cancel(p_order uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; q public.order_cancel_requests; v_note text := public._refund_text(p_note); v_by timestamptz := now() + interval '48 hours';
begin
  o := public._buyer_order_locked(p_order);
  if o.payment_status = 'confirming' then perform public._rv_raise('PAYMENT_IN_PROGRESS', '付款確認中，請稍後再試'); end if;
  if o.payment <> 'ecpay_card' or o.payment_status in ('none', 'pending', 'failed', 'expired') then
    perform public._rv_raise('ORDER_NOT_PAID', '這筆訂單不是已付款的線上付款訂單，請用「取消訂單」');
  end if;
  if o.payment_status <> 'paid' or o.status <> 'to_ship' then
    perform public._rv_raise('ORDER_STATE_CHANGED', '這筆訂單已經出貨或已取消，無法申請取消');
  end if;
  select * into q from public.order_cancel_requests where order_id = o.id for update;
  if found then
    if q.status = 'pending' then perform public._rv_raise('CANCEL_ALREADY_REQUESTED', '這筆訂單已經申請過取消'); end if;
    perform public._rv_raise('CANCEL_REQUEST_NOT_ALLOWED', '每張訂單只能申請一次取消，這筆訂單不能再申請');
  end if;
  if p_reason is null or p_reason not in ('no_longer_wanted', 'change_item', 'duplicate_order', 'seller_too_slow', 'other') then
    perform public._rv_raise('REASON_INVALID', '請選擇取消原因');
  end if;
  if char_length(coalesce(v_note, '')) > 100 then perform public._rv_raise('REASON_INVALID', '補充說明最多 100 字'); end if;
  insert into public.order_cancel_requests (order_id, reason, note, respond_by) values (o.id, p_reason, v_note, v_by);
  return jsonb_build_object('outcome', 'requested', 'respondBy', v_by);
end $$;

-- 買家撤回申請。回 {outcome:'withdrawn'}
create or replace function public.withdraw_order_cancel(p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; q public.order_cancel_requests;
begin
  o := public._buyer_order_locked(p_order);
  select * into q from public.order_cancel_requests where order_id = o.id and status = 'pending' for update;
  if not found then
    if o.status <> 'to_ship' or o.payment_status <> 'paid' then perform public._rv_raise('ORDER_STATE_CHANGED', '訂單狀態已變更，請重新整理'); end if;
    perform public._rv_raise('CANCEL_REQUEST_NOT_FOUND', '這筆申請已經有結果，請重新整理');
  end if;
  update public.order_cancel_requests set status = 'withdrawn', decided_at = now(), updated_at = now() where id = q.id;
  return jsonb_build_object('outcome', 'withdrawn');
end $$;

-- 賣家回應申請：同意 → 已取消＋退款處理中；拒絕（必填原因）→ 照常待出貨。回 {outcome:'refunding'|'rejected'}
create or replace function public.respond_order_cancel(p_order uuid, p_accept boolean, p_reject_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; q public.order_cancel_requests; v_rr text := public._refund_text(p_reject_reason);
begin
  o := public._seller_order_locked(p_order);
  select * into q from public.order_cancel_requests where order_id = o.id and status = 'pending' for update;
  if not found then
    if o.status <> 'to_ship' or o.payment_status <> 'paid' then perform public._rv_raise('ORDER_STATE_CHANGED', '訂單狀態已變更，請重新整理'); end if;
    perform public._rv_raise('CANCEL_REQUEST_NOT_FOUND', '這筆申請已經被處理（買家可能剛撤回），請重新整理');
  end if;
  if p_accept is null then perform public._rv_raise('REQUEST_INVALID', '請求格式不正確'); end if;
  if not p_accept then
    if v_rr is null then perform public._rv_raise('REJECT_REASON_REQUIRED', '請填寫拒絕原因'); end if;
    if char_length(v_rr) > 100 then perform public._rv_raise('REASON_INVALID', '拒絕原因最多 100 字'); end if;
    update public.order_cancel_requests set status = 'rejected', reject_reason = v_rr, decided_at = now(), updated_at = now() where id = q.id;
    return jsonb_build_object('outcome', 'rejected');
  end if;
  perform public._paid_order_cancel(o.id, 'buyer', q.reason, q.note);
  update public.order_cancel_requests set status = 'accepted', decided_at = now(), updated_at = now() where id = q.id;
  return jsonb_build_object('outcome', 'refunding');
end $$;

-- 賣家主動取消已付款、待出貨的線上單並全額退款。回 {outcome:'refunding'}
create or replace function public.seller_cancel_paid_order(p_order uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; v_note text := public._refund_text(p_note);
begin
  o := public._seller_order_locked(p_order);
  if o.payment <> 'ecpay_card' or o.payment_status = 'none' then
    perform public._rv_raise('ORDER_NOT_PAID', '這筆訂單不是已付款的線上付款訂單，請用「取消訂單」');
  end if;
  if o.payment_status <> 'paid' or o.status <> 'to_ship' then
    perform public._rv_raise('ORDER_STATE_CHANGED', '訂單狀態已變更，請重新整理');
  end if;
  if exists (select 1 from public.order_cancel_requests r where r.order_id = o.id and r.status = 'pending') then
    perform public._rv_raise('CANCEL_REQUEST_PENDING', '買家正在申請取消，請先同意或拒絕');
  end if;
  if p_reason is null or p_reason not in ('out_of_stock', 'buyer_asked', 'listing_error', 'other') then
    perform public._rv_raise('REASON_INVALID', '請選擇取消原因');
  end if;
  if char_length(coalesce(v_note, '')) > 100 then perform public._rv_raise('REASON_INVALID', '補充說明最多 100 字'); end if;
  perform public._paid_order_cancel(o.id, 'seller', p_reason, v_note);
  return jsonb_build_object('outcome', 'refunding');
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. 前端 RPC：讀取（沒有綠界交易編號、特約商店編號、綠界回應原文）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._cancel_request_json(q public.order_cancel_requests) returns jsonb
language sql immutable set search_path = public as $$
  select case when q.id is null then null else jsonb_build_object('status', q.status, 'reason', q.reason, 'note', q.note,
    'requested_at', q.requested_at, 'respond_by', q.respond_by, 'decided_at', q.decided_at, 'reject_reason', q.reject_reason) end;
$$;
create or replace function public._refund_json(f public.order_refunds) returns jsonb
language sql immutable set search_path = public as $$
  select case when f.id is null then null else jsonb_build_object('status', f.status, 'method', f.method, 'amount', f.amount,
    'started_at', f.started_at, 'refunded_at', f.refunded_at, 'needs_attention_since', f.needs_manual_since) end;
$$;

-- 買家：自己有申請或有退款的訂單
create or replace function public.get_my_order_refunds()
returns table (order_id uuid, cancel_request jsonb, cancelled_by text, cancel_reason text, cancel_note text, refund jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid();
begin
  return query
    select o.id, public._cancel_request_json(q), case when f.initiated_by = 'ops' then null else f.initiated_by end, f.reason, f.note, public._refund_json(f)
      from public.orders o
      left join public.order_cancel_requests q on q.order_id = o.id
      left join public.order_refunds f on f.order_id = o.id
     where o.buyer_id = v_uid and (q.id is not null or f.id is not null)
     order by o.created_at desc, o.id;
end $$;

-- 賣家：自己店有申請或有退款的訂單（另加 needs_manual、manual_hint）
create or replace function public.get_shop_order_refunds()
returns table (order_id uuid, cancel_request jsonb, cancelled_by text, cancel_reason text, cancel_note text, refund jsonb,
               needs_manual boolean, manual_hint text)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid();
begin
  if not exists (select 1 from public.shops s where s.owner_id = v_uid) then perform public._rv_raise('NO_SHOP', '你還沒有開店'); end if;
  return query
    select o.id, public._cancel_request_json(q), case when f.initiated_by = 'ops' then null else f.initiated_by end, f.reason, f.note, public._refund_json(f),
           coalesce(f.needs_manual_since is not null and f.status = 'refunding', false), case when f.status = 'refunding' then f.manual_hint end
      from public.orders o
      join public.shops s on s.id = o.shop_id and s.owner_id = v_uid
      left join public.order_cancel_requests q on q.order_id = o.id
      left join public.order_refunds f on f.order_id = o.id
     where o.payment_status in ('none', 'paid', 'refunding', 'refunded') and (q.id is not null or f.id is not null)
     order by o.created_at desc, o.id;
end $$;

-- 賣家待辦數字（輕量，第七輪補充）：申請中筆數＋最早回應期限
create or replace function public.get_shop_cancel_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._acct_uid(); v_n integer; v_min timestamptz;
begin
  if not exists (select 1 from public.shops s where s.owner_id = v_uid) then perform public._rv_raise('NO_SHOP', '你還沒有開店'); end if;
  select count(*), min(q.respond_by) into v_n, v_min
    from public.order_cancel_requests q join public.orders o on o.id = q.order_id join public.shops s on s.id = o.shop_id and s.owner_id = v_uid
   where q.status = 'pending';
  return jsonb_build_object('pending', v_n, 'earliestRespondBy', v_min);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. 伺服器端專用（payment-sweep 用 service role 呼叫）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.refund_list_due(p_limit integer default 50) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.order_refunds
   where status = 'refunding' and needs_manual_since is null and next_attempt_at <= now() and (lease_until is null or lease_until < now())
   order by next_attempt_at, id limit p_limit;
$$;

-- 搶租約：同一筆同時只有一個執行器（R-RF6）。搶不到回 null。
create or replace function public.refund_claim(p_refund uuid, p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  update public.order_refunds set lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_refund and status = 'refunding' and needs_manual_since is null and next_attempt_at <= now()
     and (lease_until is null or lease_until < now())
  returning jsonb_build_object('refundId', id, 'orderId', order_id, 'merchantId', merchant_id, 'merchantTradeNo', merchant_trade_no,
                               'amount', amount, 'attempts', attempts, 'clockFrom', coalesce(retry_from, started_at)) into v;
  return v;
end $$;

-- 寫回一次嘗試的結果（refundRunner.ts 的 RefundRecord）並放掉租約。done → 退款紀錄已退款＋訂單 refunded（同一個交易）。
-- 已經是已退款時什麼都不改（冪等），回 'refunded'。回 'refunded'｜'retry'｜'manual'。
create or replace function public.refund_record(p_refund uuid, p_rec jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare f public.order_refunds; v_order uuid; v_manual boolean := coalesce((p_rec->>'needsManual')::boolean, false);
begin
  select order_id into v_order from public.order_refunds where id = p_refund;
  if v_order is not null then perform 1 from public.orders where id = v_order for update; end if;   -- 鎖順序：訂單 → 退款紀錄（同 RPC）
  select * into f from public.order_refunds where id = p_refund for update;
  if not found then raise exception 'refund not found: %', p_refund; end if;
  if f.status = 'refunded' then return 'refunded'; end if;
  if p_rec->>'outcome' = 'done' then
    if p_rec->>'method' is null or p_rec->>'method' not in ('void', 'card_refund') then raise exception 'refund_record: bad method %', p_rec->>'method'; end if;
    update public.order_refunds set status = 'refunded', method = p_rec->>'method', refunded_at = now(), last_action = left(p_rec->>'action', 20),
           last_ecpay_status = left(p_rec->>'ecpayStatus', 30), last_attempt_at = now(), lease_until = null, updated_at = now()
     where id = f.id;
    update public.orders set payment_status = 'refunded' where id = f.order_id and payment_status = 'refunding';
    return 'refunded';
  end if;
  if p_rec->>'outcome' is null or p_rec->>'outcome' not in ('failed', 'unknown') then raise exception 'refund_record: bad outcome %', p_rec->>'outcome'; end if;
  update public.order_refunds set attempts = attempts + 1, last_action = left(p_rec->>'action', 20), last_rtn_code = (p_rec->>'rtnCode')::integer,
         last_rtn_msg = left(p_rec->>'rtnMsg', 200), last_ecpay_status = left(p_rec->>'ecpayStatus', 30), last_attempt_at = now(),
         next_attempt_at = coalesce(to_timestamp((p_rec->>'nextAttemptAt')::double precision / 1000), now() + interval '1 minute'),
         needs_manual_since = case when v_manual then coalesce(needs_manual_since, now()) else needs_manual_since end,
         manual_hint = case when v_manual then coalesce(p_rec->>'manualHint', 'other') else manual_hint end,
         lease_until = null, updated_at = now()
   where id = f.id;
  return case when v_manual then 'manual' else 'retry' end;
end $$;

-- 逾時自動同意（D27＝A）：申請中、已過回應期限 → 已取消＋退款處理中。單筆出錯（資料不一致）跳過並記警告，不擋其他筆；
-- 跳過的會出現在每日查詢第 3 條。回傳處理的筆數。
create or replace function public.refund_auto_accept_due(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; o public.orders; q public.order_cancel_requests; n integer := 0;
begin
  for r in select order_id from public.order_cancel_requests where status = 'pending' and respond_by <= now() order by respond_by limit p_limit loop
    select * into o from public.orders where id = r.order_id for update skip locked;
    if not found then continue; end if;                       -- 有人正在動這張訂單（同意／撤回）：下一輪再看
    select * into q from public.order_cancel_requests where order_id = r.order_id for update;
    if q.status <> 'pending' or q.respond_by > now() then continue; end if;
    begin
      perform public._paid_order_cancel(o.id, 'auto', q.reason, q.note);
      update public.order_cancel_requests set status = 'auto_accepted', decided_at = now(), updated_at = now() where id = q.id;
      n := n + 1;
    exception when others then
      raise warning '逾時自動同意跳過訂單 %：% (%)', o.id, sqlerrm, sqlstate;
    end;
  end loop;
  return n;
end $$;

-- 維運：需要人工的退款，原因排除後交回自動執行（36 小時從現在重算）。§10.3 第 3 點
create or replace function public.ops_retry_refund(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.order_refunds;
begin
  perform 1 from public.orders where id = p_order for update;
  select * into f from public.order_refunds where order_id = p_order for update;
  if not found then raise exception '這張訂單沒有退款紀錄' using hint = 'REFUND_NOT_FOUND'; end if;
  if f.status = 'refunded' then raise exception '這筆退款已經完成，不需要重試' using hint = 'REFUND_ALREADY_DONE'; end if;
  update public.order_refunds set needs_manual_since = null, manual_hint = null, retry_from = now(), next_attempt_at = now(), lease_until = null, updated_at = now()
   where id = f.id;
  return jsonb_build_object('ok', true, 'orderId', p_order, 'status', 'refunding', 'retryFrom', now());
end $$;

-- 維運：在綠界後台確認已完成（取消授權或退刷）後，把資料庫對齊。§10.3 第 2 點、D28＝A
--   p_method：綠界後台實際做的動作 'void'（取消授權）｜'card_refund'（退刷），存在 manual_action；退款方式一律記 'manual'。
--   退款處理中的訂單 → 已退款；運送中／已完成、已付款、沒有退款紀錄的訂單 → 新增退款紀錄（發起者 ops）並改已退款，訂單狀態不變。
--   已退款 → 拒絕；待出貨的已付款訂單 → 拒絕（請走取消並退款）。
create or replace function public.ops_mark_refund_done_manually(p_order uuid, p_method text, p_ecpay_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; f public.order_refunds; a public.payment_auths; v_note text := public._refund_text(p_ecpay_note);
begin
  if p_method is null or p_method not in ('void', 'card_refund') then
    raise exception 'p_method 要是 void（取消授權）或 card_refund（退刷）' using hint = 'REQUEST_INVALID';
  end if;
  if v_note is null then raise exception '請寫維運備註（綠界後台查到的狀態、時間、金額）' using hint = 'REQUEST_INVALID'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception '找不到這筆訂單' using hint = 'ORDER_NOT_FOUND'; end if;
  select * into f from public.order_refunds where order_id = p_order for update;
  if found then
    if f.status = 'refunded' then raise exception '這筆退款已經完成' using hint = 'REFUND_ALREADY_DONE'; end if;
    update public.order_refunds set status = 'refunded', method = 'manual', manual_action = p_method, refunded_at = now(), ops_note = left(v_note, 500),
           lease_until = null, updated_at = now()
     where id = f.id;
    update public.orders set payment_status = 'refunded' where id = o.id and payment_status = 'refunding';
    return jsonb_build_object('ok', true, 'orderId', o.id, 'status', 'refunded', 'orderStatus', o.status);
  end if;
  if o.payment <> 'ecpay_card' or o.payment_status <> 'paid' then
    raise exception '這筆訂單不是已付款的線上付款訂單' using hint = 'ORDER_NOT_PAID';
  end if;
  if o.status not in ('shipping', 'completed') then
    raise exception '待出貨的已付款訂單請用「取消並退款」（seller_cancel_paid_order），不要人工對齊' using hint = 'PAID_ORDER_USE_REFUND';
  end if;
  select * into a from public.payment_auths where order_id = o.id and group_id = o.pay_group_id and state = 'captured'
   order by attempt_no desc, created_at desc limit 1;
  if not found then raise exception '找不到這張訂單已請款的綠界授權' using hint = 'PAYMENT_AUTH_MISSING'; end if;
  insert into public.order_refunds (order_id, order_no, shop_id, auth_id, merchant_id, merchant_trade_no, initiated_by, amount,
                                    status, method, manual_action, refunded_at, ops_note)
  values (o.id, o.order_no, o.shop_id, a.id, a.merchant_id, a.merchant_trade_no, 'ops', a.amount, 'refunded', 'manual', p_method, now(), left(v_note, 500));
  update public.orders set payment_status = 'refunded' where id = o.id;
  return jsonb_build_object('ok', true, 'orderId', o.id, 'status', 'refunded', 'orderStatus', o.status);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. 權限
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  -- 前端（沒登入時以 anon 執行，_acct_uid 回中文 NOT_AUTHENTICATED，同帳號版 RPC 慣例）
  foreach f in array array['request_order_cancel(uuid,text,text)', 'withdraw_order_cancel(uuid)', 'respond_order_cancel(uuid,boolean,text)',
                           'seller_cancel_paid_order(uuid,text,text)', 'get_my_order_refunds()', 'get_shop_order_refunds()', 'get_shop_cancel_summary()'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  -- 伺服器端與維運
  foreach f in array array['refund_list_due(integer)', 'refund_claim(uuid,integer)', 'refund_record(uuid,jsonb)', 'refund_auto_accept_due(integer)',
                           'ops_retry_refund(uuid)', 'ops_mark_refund_done_manually(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- 內部工具：誰都不開放
  foreach f in array array['_order_restock(uuid)', '_paid_order_cancel(uuid,text,text,text)', '_refund_text(text)', '_buyer_order_locked(uuid)',
                           '_seller_order_locked(uuid)', '_cancel_request_json(public.order_cancel_requests)', '_refund_json(public.order_refunds)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. 自我檢查：權限不如預期就整個回滾
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r text; t text; p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['order_cancel_requests', 'order_refunds'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) then raise exception '退款自我檢查失敗：% 對 % 有 % 權限，整個交易回滾', r, t, p; end if;
      end loop;
    end loop;
    foreach t in array array['refund_list_due(integer)', 'refund_claim(uuid,integer)', 'refund_record(uuid,jsonb)', 'refund_auto_accept_due(integer)',
                             'ops_retry_refund(uuid)', 'ops_mark_refund_done_manually(uuid,text,text)', '_paid_order_cancel(uuid,text,text,text)',
                             '_order_restock(uuid)', '_orders_guard_payment()', '_buyer_order_locked(uuid)', '_seller_order_locked(uuid)'] loop
      if has_function_privilege(r, 'public.' || t, 'execute') then raise exception '退款自我檢查失敗：% 可以執行 %，整個交易回滾', r, t; end if;
    end loop;
    if has_column_privilege(r, 'public.orders', 'payment_status', 'select') or has_column_privilege(r, 'public.orders', 'payment_status', 'update') then
      raise exception '退款自我檢查失敗：% 對 orders.payment_status 有權限，整個交易回滾', r;
    end if;
  end loop;
  foreach t in array array['request_order_cancel(uuid,text,text)', 'withdraw_order_cancel(uuid)', 'respond_order_cancel(uuid,boolean,text)',
                           'seller_cancel_paid_order(uuid,text,text)', 'get_my_order_refunds()', 'get_shop_order_refunds()', 'get_shop_cancel_summary()'] loop
    if not has_function_privilege('authenticated', 'public.' || t, 'execute') then raise exception '退款自我檢查失敗：authenticated 不能執行 %', t; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.refund_claim(uuid,integer)', 'execute') then
    raise exception '退款自我檢查失敗：service_role 不能執行 refund_claim';
  end if;
  foreach t in array array['request_order_cancel', 'withdraw_order_cancel', 'respond_order_cancel', 'seller_cancel_paid_order', 'get_my_order_refunds',
                           'get_shop_order_refunds', 'get_shop_cancel_summary', 'refund_claim', 'refund_record', 'ops_retry_refund', 'ops_mark_refund_done_manually'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = t) <> 1 then
      raise exception '退款自我檢查失敗：% 有多載（PostgREST 會 PGRST203），整個交易回滾', t;
    end if;
  end loop;
  -- 不新增任何指向 auth.users 的外鍵（刪帳號工具 KNOWN_FK 的 with_payment 組是 10 個）
  if exists (select 1 from pg_constraint c where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
               and c.conrelid in ('public.order_cancel_requests'::regclass, 'public.order_refunds'::regclass)) then
    raise exception '退款自我檢查失敗：新表有指向 auth.users 的外鍵，整個交易回滾';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_guard_payment' and tgenabled = 'O' and not tgisinternal) then
    raise exception '退款自我檢查失敗：orders 上沒有啟用的 orders_guard_payment，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
