-- 刪除帳號申請制（.work/store-prereqs/spec.md §6、§10.1、§12；工單 B-1；決策 N1＝A、N2、N6、N7）
--
-- 只做相容的新增：一張新表 account_deletion_requests、三個前端 RPC，以及 _del_* 內部函式。
-- 不動任何既有的表、欄位、權限、函式；舊前端不讀這些，所以先套資料庫、再推前端都安全。
-- 只依賴 20261016120000（_rv_raise）與 20261017120000（_acct_uid）與基準檔的 orders／shops；
-- 不依賴 20261019200000～20261020140000（金流）任何一支，所以也能套在「尚未套金流的正式站」。
--
-- 設計重點：
--   · 表不建任何外鍵（N7）：user_id 只是 uuid。帳號被刪後申請紀錄保留（R-D7），
--     而且手機版刪帳號工具／刪店工具的外鍵防呆清單完全不用改（AC-D30、AC-D31）。
--     所以這張表也不放 email、門號、姓名（R-D7）。
--   · 權限：對 anon、authenticated 零權限（連 select 都沒有），RLS 開著且不建 policy。
--     寫入只有三個 RPC（只能建／取消「自己的」）與 service role（站方工具）。
--   · 同一帳號 pending 最多 1 筆：部分唯一索引＋advisory lock（鎖讓競爭者排隊，所以前端看到的是
--     中文 DELETION_ALREADY_REQUESTED，不會是英文的唯一鍵錯誤；索引是第二道鎖，連 service role 也擋）。
--   · 預計完成日（due_date）由伺服器算（R-D3、N2）：_del_due_date(requested_at) —— 申請日（台北日期）的
--     「下一個」工作天算第 1 天，只跳過週六、週日，不扣國定假日，第 7 個工作天為預計完成日。
--     BEFORE INSERT 觸發器一律用它覆寫 due_date（不信任呼叫端，包含 service role）。
--   · 狀態不可逆：只允許 pending → cancelled｜done；done／cancelled 之後整列不能再改（AC-D18）。
--     站方工具在刪帳號的同一個交易把 pending 標成 done（R-D6）是合法的 pending → done。
--   · 未完成訂單＝status 為 to_ship（待出貨）或 shipping（運送中）。買家身分看 orders.buyer_id，
--     有店時看店內（orders.shop_id）。兩者都有 → 回 DELETION_ORDERS_UNFINISHED（先處理自己的購買，R-D2）。
--
-- 錯誤格式沿用既有慣例：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）。
-- 帳號版 RPC 開給 anon（慣例同 buyer_accounts_m1）：session 過期時得到中文的 NOT_AUTHENTICATED。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 預計完成日（純函式）
-- ═══════════════════════════════════════════════════════════════════════
-- 例：2026-10-26（一）→ 2026-11-04；10/30（五）→ 11-10；10/25（日）→ 11-03。
-- 台北沒有日光節約時間，所以 at time zone 'Asia/Taipei' 等於固定 +08:00；IMMUTABLE 成立。
create or replace function public._del_due_date(p_requested_at timestamptz)
returns date language plpgsql immutable set search_path = public as $$
declare
  d date := (p_requested_at at time zone 'Asia/Taipei')::date;
  n int  := 0;
begin
  while n < 7 loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;   -- 1..5 是週一到週五
  end loop;
  return d;
end $$;
revoke all on function public._del_due_date(timestamptz) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 資料表
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.account_deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                              -- 帳號識別碼；刻意不是外鍵（N7）
  status       text not null default 'pending',
  requested_at timestamptz not null default now(),
  due_date     date not null,                              -- 台北日期；由 _del_guard 觸發器依 _del_due_date 寫入
  cancelled_at timestamptz,
  completed_at timestamptz,
  had_shop     boolean not null default false,             -- 申請當時帳號是否有店
  constraint account_deletion_status_valid check (status in ('pending', 'cancelled', 'done')),
  -- 狀態與時間成對：pending 兩者皆空；cancelled 只有取消時間；done 只有完成時間
  constraint account_deletion_state_pair check (
    (status = 'pending'   and cancelled_at is null     and completed_at is null)
 or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
 or (status = 'done'      and completed_at is not null and cancelled_at is null)),
  -- 預計完成日必須晚於申請日（台北日期）
  constraint account_deletion_due_after check (due_date > (requested_at at time zone 'Asia/Taipei')::date)
);
-- R-D1：每個帳號最多一筆處理中（競爭下也成立）
create unique index if not exists account_deletion_one_pending on public.account_deletion_requests (user_id) where status = 'pending';
-- 站方工具「列出待處理申請」依預計完成日排序
create index if not exists account_deletion_pending_due on public.account_deletion_requests (due_date, requested_at) where status = 'pending';
-- 查某帳號的歷史
create index if not exists account_deletion_user on public.account_deletion_requests (user_id, requested_at desc);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 觸發器：due_date 一律由伺服器算；狀態不可逆；識別欄位不可改（任何寫入路徑都擋，包含 service role）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._del_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.due_date := public._del_due_date(new.requested_at);
    return new;
  end if;
  -- UPDATE
  if old.status <> 'pending' then
    raise exception '刪除申請完成或取消後不能再修改' using hint = 'DELETION_STATE_FINAL';
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.requested_at is distinct from old.requested_at or new.due_date is distinct from old.due_date
     or new.had_shop is distinct from old.had_shop then
    raise exception '刪除申請的帳號、申請時間與預計完成日不能修改' using hint = 'DELETION_FIELD_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function public._del_guard() from public, anon, authenticated;

drop trigger if exists account_deletion_guard on public.account_deletion_requests;
create trigger account_deletion_guard before insert or update on public.account_deletion_requests
  for each row execute function public._del_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 內部小工具
-- ═══════════════════════════════════════════════════════════════════════
-- 前端看的 request 物件（不含 user_id、had_shop、cancelled_at、completed_at）
create or replace function public._del_json(r public.account_deletion_requests)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'requested_at', r.requested_at, 'due_date', r.due_date);
$$;
revoke all on function public._del_json(public.account_deletion_requests) from public, anon, authenticated;

-- 帳號有沒有店、買家身分的未完成訂單數、店內的未完成訂單數（未完成＝待出貨或運送中）
create or replace function public._del_counts(p_uid uuid, out has_shop boolean, out buyer_orders int, out shop_orders int)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shops s where s.owner_id = p_uid),
         (select count(*)::int from public.orders o where o.buyer_id = p_uid and o.status in ('to_ship', 'shipping')),
         (select count(*)::int from public.orders o
           where o.status in ('to_ship', 'shipping')
             and o.shop_id in (select s.id from public.shops s where s.owner_id = p_uid));
$$;
revoke all on function public._del_counts(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC（§10.1）
-- ═══════════════════════════════════════════════════════════════════════
-- 目前狀態：{ request: {id,status,requested_at,due_date}|null, has_shop, unfinished_buyer_orders, unfinished_shop_orders }
create or replace function public.get_account_deletion_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入');
  v_req public.account_deletion_requests;
  c     record;
begin
  select * into v_req from public.account_deletion_requests where user_id = v_uid and status = 'pending';
  select * into c from public._del_counts(v_uid);
  return jsonb_build_object(
    'request', case when v_req.id is null then null else public._del_json(v_req) end,
    'has_shop', c.has_shop,
    'unfinished_buyer_orders', c.buyer_orders,
    'unfinished_shop_orders', c.shop_orders);
end $$;

-- 申請：回新建那筆的 request 物件。
--   已有處理中 → DELETION_ALREADY_REQUESTED；買家身分有未完成訂單（含兩者都有）→ DELETION_ORDERS_UNFINISHED；
--   只有店內有 → DELETION_SHOP_ORDERS_UNFINISHED。
create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入');
  v_req public.account_deletion_requests;
  c     record;
begin
  -- 同一帳號的申請／取消排隊（和 cancel_account_deletion 同一把鎖）
  perform pg_advisory_xact_lock(hashtextextended('del-req:' || v_uid::text, 0));
  if exists (select 1 from public.account_deletion_requests where user_id = v_uid and status = 'pending') then
    perform public._rv_raise('DELETION_ALREADY_REQUESTED', '你已經申請過刪除帳號，正在處理中');
  end if;
  select * into c from public._del_counts(v_uid);
  if c.buyer_orders > 0 then
    perform public._rv_raise('DELETION_ORDERS_UNFINISHED', '你還有待出貨或運送中的訂單，完成或取消後才能申請刪除帳號');
  end if;
  if c.shop_orders > 0 then
    perform public._rv_raise('DELETION_SHOP_ORDERS_UNFINISHED', '你的店還有待出貨或運送中的訂單，處理完成後才能申請刪除帳號');
  end if;
  begin
    insert into public.account_deletion_requests (user_id, had_shop) values (v_uid, c.has_shop) returning * into v_req;
  exception when unique_violation then   -- 理論上被鎖擋掉；萬一（例如站方工具同時寫入）也回中文碼
    perform public._rv_raise('DELETION_ALREADY_REQUESTED', '你已經申請過刪除帳號，正在處理中');
  end;
  return public._del_json(v_req);
end $$;

-- 取消：只能取消自己「處理中」的那筆。
create or replace function public.cancel_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入');
  v_id  uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('del-req:' || v_uid::text, 0));
  update public.account_deletion_requests
     set status = 'cancelled', cancelled_at = now()
   where user_id = v_uid and status = 'pending'
   returning id into v_id;
  if v_id is null then
    perform public._rv_raise('DELETION_NOT_PENDING', '沒有處理中的刪除申請');
  end if;
  return jsonb_build_object('cancelled', true);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 函式權限
-- ═══════════════════════════════════════════════════════════════════════
revoke all on function public.get_account_deletion_status() from public;
revoke all on function public.request_account_deletion()    from public;
revoke all on function public.cancel_account_deletion()     from public;
grant execute on function public.get_account_deletion_status() to anon, authenticated;
grant execute on function public.request_account_deletion()    to anon, authenticated;
grant execute on function public.cancel_account_deletion()     to anon, authenticated;
