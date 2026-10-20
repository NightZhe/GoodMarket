-- 撥款對帳：綠界撥款對帳檔（35670）→ 賣家訂單的撥款狀態（.work/account-payment-methods/spec-payout-reconcile.md 工單 PR-B2；
-- decisions.md 第七輪 D40＝A、D41＝A、D42＝C、D43＝A、D44＝A、D47＝A）
--
-- 前提：已套 20261019200000_ecpay_payments.sql（沒套會直接中止，不做任何事）。退款 migration 不是前提（只讀 payment_status 的文字值）。
-- 只做相容的新增，不改任何既有物件、不收回任何權限、不動既有資料：
--   · 新表（全部開 RLS，anon／authenticated 沒有任何權限，只能經由 RPC 讀）：
--       payout_settings  對帳開關（預設關）、停機旗標（綠界回 ECPAY_DENIED 時全部停）、最近一次呼叫綠界的時間（一分鐘一個檔）
--       payout_jobs      排程的工作佇列（一家店、一段日期一件）
--       payout_imports   匯入紀錄（每次呼叫綠界或匯入一個檔一筆；§6.4）。不存原始檔，只存大小與 SHA-256
--       payout_ledger    對上的對帳列（§5.1 三項全對才會進來）；隨訂單刪除（訂單隨店 cascade，§3.3）
--       payout_anomalies 異常紀錄（§6.5；foreign 不記、duplicate 不記）
--     卡號、發卡銀行（63766 格式才有）不存在任何表：解析器只留認得的欄位，寫入時這裡再只挑固定欄位（AC-R4）。
--     平台手續費（platform_fee）存著但沒有任何 RPC 回傳（D42＝C、AC-R11）。
--   · 撥款狀態（§6.1）不存，每次讀時由「這張訂單對上的列＋這家店最近成功匯入時間＋現在」推算（_payout_view），所以重跑不會讓狀態亂跳。
--   · 前端 RPC：get_seller_order_payouts（anon＋authenticated 可執行；匿名或沒開店回空陣列）。
--   · 伺服器端專用（只有 service_role，Edge Function payout-reconcile 用）：payout_tick_claim、payout_reserve_call、payout_import_begin、
--     payout_ingest、payout_classify、payout_import_finish、payout_job_finish、payout_enqueue_daily、payout_enqueue_backfill；
--     維運：payout_ops_resume、payout_ops_resolve_anomaly（prod-runbook-pb.md §12）。
-- 錯誤格式沿用 _rv_raise：message＝中文、hint＝錯誤碼。介面見 .work/account-payment-methods/interface-payment.md 第 9 節「撥款對帳」。
-- 可重複執行；整個檔案一個交易。回滾：.work/account-payment-methods/tools/pb/rollback-payout.sql（有任何對帳資料時會中止）。
begin;

do $$
begin
  if to_regclass('public.payment_auths') is null or to_regclass('public.seller_ecpay_merchants') is null then
    raise exception '請先套 20261019200000_ecpay_payments.sql（找不到 payment_auths／seller_ecpay_merchants），整個交易回滾';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 設定：對帳開關（預設關）、停機旗標、呼叫額度
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.payout_settings (
  id                 boolean primary key default true check (id),   -- 只允許一列
  reconcile_enabled  boolean not null default false,                 -- 對帳開關（§7.1）：跟付款開關分開，等 U-R1／U-R2 解決才開
  ecpay_last_call_at timestamptz,                                    -- 最近一次「取得呼叫額度」的時間：下一次要隔 61 秒（綠界一分鐘一個檔＋1 秒餘裕，
                                                                     -- 因為取得額度到真的送出請求之間有幾十毫秒的落差；AC-R14；U-R3 未回覆前當成全平台共用）
  halted_at          timestamptz,                                    -- 綠界回 ECPAY_DENIED：全部停，人處理後 payout_ops_resume()
  halt_code          text,
  halt_message       text,
  updated_at         timestamptz not null default now()
);
insert into public.payout_settings (id) values (true) on conflict (id) do nothing;
alter table public.payout_settings enable row level security;
revoke all on public.payout_settings from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 工作佇列、匯入紀錄、對上的列、異常
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.payout_jobs (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     text not null check (merchant_id ~ '^[0-9]{7,10}$'),
  run_date        date not null,                                     -- 哪一天（台灣）排的
  kind            text not null check (kind in ('daily', 'backfill')),
  date_type       text not null default 'settle' check (date_type in ('settle', 'payout')),
  date_from       date not null,
  date_to         date not null,
  status          text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  last_import_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (date_from <= date_to and date_to - date_from <= 30),        -- 35670「調閱區間最大為1個月」
  unique (merchant_id, run_date, kind, date_type, date_from, date_to) -- 同一天重複排不會多一件
);
create index if not exists payout_jobs_due_idx on public.payout_jobs (next_attempt_at) where status in ('queued', 'running');
alter table public.payout_jobs enable row level security;
revoke all on public.payout_jobs from public, anon, authenticated;

create table if not exists public.payout_imports (
  id             uuid primary key default gen_random_uuid(),
  trigger        text not null check (trigger in ('schedule', 'manual_fetch', 'manual_file')),
  merchant_id    text not null check (merchant_id ~ '^[0-9]{7,10}$'),
  job_id         uuid references public.payout_jobs(id) on delete set null,
  date_type      text check (date_type in ('settle', 'payout')),
  date_from      date,
  date_to        date,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  result         text not null default 'running' check (result in ('running', 'ok', 'empty', 'failed')),
  error_code     text check (error_code in ('ECPAY_UNAVAILABLE', 'RATE_LIMITED', 'ECPAY_DENIED', 'PARSE_HEADER', 'PARSE_ENCODING', 'INTERNAL')),
  error_detail   text check (char_length(error_detail) <= 200),     -- 綠界的錯誤訊息原文（截斷）；不含金鑰
  file_bytes     integer,
  file_sha256    text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  encoding       text check (encoding in ('utf-8', 'big5')),
  total_rows     integer,
  counts         jsonb not null default '{}'::jsonb,                -- §5.2 每一類的列數
  orders_changed integer not null default 0,                         -- 這次新寫入撥款資料的訂單數
  check ((result = 'failed') = (error_code is not null)),
  check ((result = 'running') = (finished_at is null))
);
create index if not exists payout_imports_ok_idx on public.payout_imports (merchant_id, finished_at desc) where result in ('ok', 'empty');
create index if not exists payout_imports_started_idx on public.payout_imports (started_at desc);
alter table public.payout_imports enable row level security;
revoke all on public.payout_imports from public, anon, authenticated;

create table if not exists public.payout_ledger (
  id                uuid primary key default gen_random_uuid(),
  fingerprint       text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),   -- 這一列是哪一筆交易（＋同檔第幾次出現）：重跑不重複寫
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),         -- 全部欄位：指紋相同、這個不同＝綠界補上撥款日／更正手續費 → 更新這一列（不是新的一列）
  import_id         uuid not null references public.payout_imports(id),            -- 第一次寫入的匯入
  last_import_id    uuid not null references public.payout_imports(id),            -- 最近一次改到這一列的匯入
  merchant_id       text not null,
  order_id          uuid not null references public.orders(id) on delete cascade,
  auth_id           uuid not null references public.payment_auths(id),
  merchant_trade_no text not null,
  ecpay_trade_no    text,
  kind              text not null check (kind in ('charge', 'refund')),            -- refund＝交易金額為負（退刷／扣回）
  trade_at          timestamp,                                                     -- 台灣時間（檔案原樣）
  pay_method        text,
  fee_rate          text,
  settle_date       date,
  payout_date       date,                                                          -- 撥款日；綠界在撥款日到之前留空（t8 實測）
  amount            integer not null check (amount <> 0),
  gateway_fee       numeric(14, 4),                                                -- 金流手續費（實測已含金流處理費）
  platform_fee      integer,                                                       -- 平台手續費：D23 未定，任何 RPC 都不回傳
  refund_amount     integer,
  net_amount        integer,                                                       -- 應收款項(淨額)
  processing_fee    numeric(14, 4),
  line              integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),                            -- 撥款資料最後真的有變的時間（AC-R7：重跑同內容不會動）
  check ((kind = 'refund') = (amount < 0))
);
create index if not exists payout_ledger_order_idx on public.payout_ledger (order_id);
alter table public.payout_ledger enable row level security;
revoke all on public.payout_ledger from public, anon, authenticated;

create table if not exists public.payout_anomalies (
  id                uuid primary key default gen_random_uuid(),
  fingerprint       text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),   -- 同一列每天重查不會多一筆，只更新 last_seen_at／seen_count
  first_import_id   uuid not null references public.payout_imports(id),
  last_import_id    uuid not null references public.payout_imports(id),
  merchant_id       text not null,
  class             text not null check (class in ('unmatched', 'not_captured', 'bind_auth', 'key_conflict', 'amount_mismatch', 'invalid')),
  priority          text not null check (priority in ('high', 'normal')),          -- high＝not_captured／bind_auth（§6.5）
  merchant_trade_no text,
  order_id          uuid,                                                          -- 找得到授權時的訂單（參考用，不設外鍵：異常紀錄不隨訂單刪）
  reason            text,
  row_data          jsonb not null,                                                -- 只有固定欄位（沒有卡號、發卡銀行）
  seen_count        integer not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  status            text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note   text,
  resolved_at       timestamptz,
  check ((status = 'resolved') = (resolved_at is not null))
);
create index if not exists payout_anomalies_open_idx on public.payout_anomalies (priority, first_seen_at) where status = 'open';
alter table public.payout_anomalies enable row level security;
revoke all on public.payout_anomalies from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 對應與分類（§5；一列只會落在一類）
-- ═══════════════════════════════════════════════════════════════════════
-- 本站授權編號的格式：P（付款）／B（綁卡驗證）＋YYMMDDHHMMSS（台灣時間）＋7 碼小寫十六進位（_rand_trade_no，20 字）。
-- 比 spec 寫的「P＋12 位＋7 碼」多驗了日期時間的範圍：綠界測試環境的共用檔裡有別人的「B＋19 位數字」編號，只看長度會被誤判成本站的綁卡授權。
create or replace function public._payout_is_ours(p_no text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_no ~ '^[PB][0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])[0-5][0-9][0-5][0-9][0-9a-f]{7}$', false);
$$;

-- 這一列的值放不放得進資料表（型別、範圍）。放不進去回原因，放得進去回 null。
-- 解析器（payoutFile.ts）已經擋過；這是第二道：不讓一列怪資料讓整段寫入失敗（D43＝A，小q BUG-3）
create or replace function public._payout_row_problem(r jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare v_x numeric; v_d date; v_t timestamp; v_i integer;
begin
  v_i := (r->>'amount')::integer; v_i := (r->>'platformFee')::integer; v_i := (r->>'refundAmount')::integer; v_i := (r->>'netAmount')::integer;
  v_i := (r->>'line')::integer;
  v_x := (r->>'gatewayFee')::numeric(14, 4); v_x := (r->>'processingFee')::numeric(14, 4);
  v_d := (r->>'settleDate')::date; v_d := (r->>'payoutDate')::date; v_t := (r->>'tradeAt')::timestamp;
  if coalesce(r->>'merchantTradeNo', '') = '' then return '特店交易編號是空的'; end if;
  if r->>'amount' is null then return '交易金額是空的'; end if;
  if coalesce(r->>'ch', '') !~ '^[0-9a-f]{64}$' then return '內容雜湊格式不正確'; end if;
  return null;
exception when data_exception then
  return '值放不進資料表（' || sqlstate || '）';
end $$;

-- 分類一段列（p_rows：Edge Function 解析好的 JSON 陣列，見 payoutRunner.ts 的 IngestRow）。只讀，不寫。
-- 同一段裡的列依序處理，前面的列會影響後面的（同訂單第二個正數列、退款加總），跟寫入時的結果一致。
create or replace function public._payout_classify_rows(p_merchant text, p_rows jsonb)
returns table (idx integer, cls text, order_id uuid, auth_id uuid, reason text)
language plpgsql stable set search_path = public as $$
declare
  r        jsonb;
  i        integer := 0;
  a        public.payment_auths;
  v_no     text;
  v_amt    integer;
  v_charge jsonb := '{}'::jsonb;   -- 這一段裡已判 matched 的正數列：order_id → true
  v_refund jsonb := '{}'::jsonb;   -- 這一段裡已判 matched 的退款合計：order_id → 金額
  v_same   boolean;
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1; idx := i; order_id := null; auth_id := null; reason := null;
    if r->>'kind' = 'invalid' then cls := 'invalid'; reason := r->>'reason'; return next; continue; end if;
    reason := public._payout_row_problem(r);
    if reason is not null then cls := 'invalid'; return next; continue; end if;
    -- 同一列已寫入：內容相同＝duplicate；內容不同（綠界補上撥款日、更正手續費）＝updated（小q BUG-1／BUG-2：不能當成第二列）
    select l.order_id, l.auth_id, (l.content_hash = r->>'ch') into order_id, auth_id, v_same from public.payout_ledger l where l.fingerprint = r->>'fp';
    if found then cls := case when v_same then 'duplicate' else 'updated' end; return next; continue; end if;
    order_id := null; auth_id := null;
    v_no := r->>'merchantTradeNo';
    v_amt := (r->>'amount')::integer;
    if not public._payout_is_ours(v_no) then cls := 'foreign'; return next; continue; end if;
    if left(v_no, 1) = 'B' then cls := 'bind_auth'; reason := '綁卡驗證授權出現在對帳檔（應該已放棄）'; return next; continue; end if;
    select * into a from public.payment_auths x where x.merchant_trade_no = v_no;
    if not found or a.order_id is null then cls := 'unmatched'; reason := '找不到這筆授權'; return next; continue; end if;
    order_id := a.order_id; auth_id := a.id;
    if a.merchant_id <> p_merchant then cls := 'key_conflict'; reason := '授權屬於另一個特約商店 ' || a.merchant_id; return next; continue; end if;
    if nullif(r->>'ecpayTradeNo', '') is distinct from a.ecpay_trade_no then cls := 'key_conflict'; reason := '綠界交易編號不同'; return next; continue; end if;
    if a.state <> 'captured' then cls := 'not_captured'; reason := '本站記錄這筆授權是 ' || a.state; return next; continue; end if;
    if v_amt > 0 then
      if v_amt <> a.amount then cls := 'amount_mismatch'; reason := format('交易金額 %s ≠ 授權金額 %s', v_amt, a.amount); return next; continue; end if;
      if v_charge ? a.order_id::text or exists (select 1 from public.payout_ledger l where l.order_id = a.order_id and l.kind = 'charge') then
        cls := 'amount_mismatch'; reason := '同一張訂單出現第二個正數列（§5.3）'; return next; continue;
      end if;
      v_charge := v_charge || jsonb_build_object(a.order_id::text, true);
    elsif v_amt < 0 then
      if coalesce((v_refund->>a.order_id::text)::integer, 0) - v_amt
         + coalesce((select sum(-l.amount) from public.payout_ledger l where l.order_id = a.order_id and l.kind = 'refund'), 0) > a.amount then
        cls := 'amount_mismatch'; reason := '退款合計超過授權金額'; return next; continue;
      end if;
      v_refund := v_refund || jsonb_build_object(a.order_id::text, coalesce((v_refund->>a.order_id::text)::integer, 0) - v_amt);
    else
      cls := 'amount_mismatch'; reason := '交易金額是 0'; return next; continue;
    end if;
    cls := 'matched'; return next;
  end loop;
end $$;

create or replace function public._payout_counts(p_classes text[]) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (select c, count(*) as n from unnest(p_classes) c group by c) t;
$$;

-- 只分類計數（dryRun，AC-R20：資料庫不變）
create or replace function public.payout_classify(p_merchant text, p_rows jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select public._payout_counts(coalesce(array_agg(c.cls), '{}')) from public._payout_classify_rows(p_merchant, p_rows) c;
$$;

-- 像卡號的字串（前六後四隱碼，例如 431195******1111）一律遮罩。錯位的列裡卡號可能落在任何欄名底下，不能靠欄位位置（AC-R4、小q BUG-4）。
-- 解析器（maskCardLike）已經遮過一次（另含 Luhn 檢查的 13～19 位數字）；這是第二道
create or replace function public._payout_mask(v jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(v) = 'string'
    then to_jsonb(regexp_replace(v #>> '{}', '[0-9][0-9 -]*[*＊•●][0-9 *＊•●-]*[*＊•●][0-9 *＊•●-]*[0-9]', '[已遮罩]', 'g')) else v end;
$$;

-- 異常列只留固定欄位（卡號等其他欄位就算混進來也丟掉，AC-R4），字串值再遮罩一次
create or replace function public._payout_row_data(r jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when r->>'kind' = 'invalid'
    then jsonb_build_object('line', r->'line', 'reason', r->'reason', 'cells', (select coalesce(jsonb_object_agg(k, public._payout_mask(v)), '{}'::jsonb) from jsonb_each(coalesce(r->'cells', '{}'::jsonb)) e(k, v)
           where k in ('特店交易編號', '綠界交易編號', '交易日期', '付款方式', '手續費率', '結算日期', '撥款日期', '交易金額', '金流手續費', '平台手續費', '退款金額', '應收款項(淨額)', '金流處理費')))
    else (select coalesce(jsonb_object_agg(k, public._payout_mask(v)), '{}'::jsonb) from jsonb_each(r) e(k, v)
           where k in ('line', 'occurrence', 'merchantTradeNo', 'ecpayTradeNo', 'tradeAt', 'payMethod', 'feeRate', 'settleDate', 'payoutDate', 'amount',
                       'gatewayFee', 'platformFee', 'refundAmount', 'netAmount', 'processingFee')) end;
$$;

-- 分類並寫入一段（同一家店同時只有一個寫入：advisory lock）。回這一段的計數＋ordersChanged。
-- 異常列永遠不會寫進 payout_ledger（AC-R9）；duplicate 不寫；foreign 不記（§5.2）。整段一個交易：中途出錯整段不寫。
create or replace function public.payout_ingest(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  imp     public.payout_imports;
  c       record;
  r       jsonb;
  v_cls   text[] := '{}';
  v_ord   uuid[] := '{}';
  v_n     integer;
begin
  select * into imp from public.payout_imports where id = p_import;
  if not found then raise exception 'payout import not found: %', p_import; end if;
  if imp.result <> 'running' then raise exception 'payout import % already finished', p_import; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || imp.merchant_id));
  for c in select * from public._payout_classify_rows(imp.merchant_id, p_rows) loop
    r := p_rows -> (c.idx - 1);
    if c.cls = 'matched' then
      insert into public.payout_ledger (fingerprint, content_hash, import_id, last_import_id, merchant_id, order_id, auth_id, merchant_trade_no, ecpay_trade_no, kind, trade_at, pay_method, fee_rate,
                                        settle_date, payout_date, amount, gateway_fee, platform_fee, refund_amount, net_amount, processing_fee, line)
      values (r->>'fp', r->>'ch', p_import, p_import, imp.merchant_id, c.order_id, c.auth_id, r->>'merchantTradeNo', nullif(r->>'ecpayTradeNo', ''),
              case when (r->>'amount')::integer < 0 then 'refund' else 'charge' end, (r->>'tradeAt')::timestamp, r->>'payMethod', r->>'feeRate',
              (r->>'settleDate')::date, (r->>'payoutDate')::date, (r->>'amount')::integer, (r->>'gatewayFee')::numeric, (r->>'platformFee')::integer,
              (r->>'refundAmount')::integer, (r->>'netAmount')::integer, (r->>'processingFee')::numeric, (r->>'line')::integer)
      on conflict (fingerprint) do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then v_cls := v_cls || 'matched'::text; v_ord := v_ord || c.order_id; else v_cls := v_cls || 'duplicate'::text; end if;
    elsif c.cls = 'updated' then
      -- 同一列，綠界補上／更正了欄位：只改「之後才會變」的欄位；身分欄位（編號、交易時間、結算日、金額）在指紋裡，不會變
      update public.payout_ledger set content_hash = r->>'ch', last_import_id = p_import, updated_at = now(),
             payout_date = (r->>'payoutDate')::date, gateway_fee = (r->>'gatewayFee')::numeric, platform_fee = (r->>'platformFee')::integer,
             refund_amount = (r->>'refundAmount')::integer, net_amount = (r->>'netAmount')::integer, processing_fee = (r->>'processingFee')::numeric,
             pay_method = r->>'payMethod', fee_rate = r->>'feeRate', line = (r->>'line')::integer
       where fingerprint = r->>'fp' and content_hash is distinct from r->>'ch';
      get diagnostics v_n = row_count;
      if v_n = 1 then v_cls := v_cls || 'updated'::text; v_ord := v_ord || c.order_id; else v_cls := v_cls || 'duplicate'::text; end if;
    elsif c.cls in ('duplicate', 'foreign') then
      v_cls := v_cls || c.cls;
    else
      insert into public.payout_anomalies (fingerprint, first_import_id, last_import_id, merchant_id, class, priority, merchant_trade_no, order_id, reason, row_data)
      values (r->>'fp', p_import, p_import, imp.merchant_id, c.cls, case when c.cls in ('not_captured', 'bind_auth') then 'high' else 'normal' end,
              coalesce(r->>'merchantTradeNo', r->'cells'->>'特店交易編號'), c.order_id, left(c.reason, 200), public._payout_row_data(r))
      on conflict (fingerprint) do update set last_import_id = excluded.last_import_id, last_seen_at = now(), seen_count = payout_anomalies.seen_count + 1,
        row_data = excluded.row_data, reason = excluded.reason;
      v_cls := v_cls || c.cls;
    end if;
  end loop;
  return public._payout_counts(v_cls) || jsonb_build_object('ordersChanged', (select count(distinct x) from unnest(v_ord) x));
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 匯入紀錄、工作佇列、呼叫額度
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.payout_import_begin(p_trigger text, p_merchant text, p_date_type text, p_from date, p_to date, p_job uuid)
returns uuid language sql security definer set search_path = public as $$
  insert into public.payout_imports (trigger, merchant_id, job_id, date_type, date_from, date_to)
  values (p_trigger, p_merchant, p_job, p_date_type, p_from, p_to) returning id;
$$;

create or replace function public.payout_import_finish(p_import uuid, p_finish jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb := coalesce(p_finish->'counts', '{}'::jsonb);
begin
  update public.payout_imports set
    finished_at = now(), result = p_finish->>'result', error_code = p_finish->>'errorCode', error_detail = left(p_finish->>'errorDetail', 200),
    file_bytes = (p_finish->>'fileBytes')::integer, file_sha256 = p_finish->>'fileSha256', encoding = p_finish->>'encoding',
    total_rows = (p_finish->>'totalRows')::integer, counts = c - 'ordersChanged', orders_changed = coalesce((c->>'ordersChanged')::integer, 0)
   where id = p_import and result = 'running';
  if not found then raise exception 'payout import % not running', p_import; end if;
end $$;

-- 排程一分鐘一次：開關、停機、呼叫額度、取工作，一個交易裡判斷（settings 那一列 for update，兩個排程同時跑也只有一個拿得到）
create or replace function public.payout_tick_claim(p_lease_seconds integer default 300, p_min_interval_seconds integer default 61)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; j public.payout_jobs;
begin
  select * into s from public.payout_settings where id for update;
  if not s.reconcile_enabled then return jsonb_build_object('state', 'disabled'); end if;
  if s.halted_at is not null then return jsonb_build_object('state', 'halted'); end if;
  if s.ecpay_last_call_at > now() - make_interval(secs => p_min_interval_seconds) then
    return jsonb_build_object('state', 'wait', 'retryAfterSeconds', ceil(extract(epoch from s.ecpay_last_call_at + make_interval(secs => p_min_interval_seconds) - now()))::integer);
  end if;
  -- 租約過期（函式中途死掉）：算一次失敗；滿 3 次就放棄今天這件
  update public.payout_jobs set status = case when attempts + 1 >= 3 then 'failed' else 'queued' end, attempts = attempts + 1,
         lease_until = null, next_attempt_at = now(), updated_at = now()
   where status = 'running' and lease_until < now();
  select * into j from public.payout_jobs x
   where x.status = 'queued' and x.next_attempt_at <= now()
     and not exists (select 1 from public.payout_jobs y where y.merchant_id = x.merchant_id and y.status = 'running')
   order by x.next_attempt_at, x.created_at, x.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('state', 'idle'); end if;
  update public.payout_jobs set status = 'running', lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now() where id = j.id;
  update public.payout_settings set ecpay_last_call_at = now(), updated_at = now() where id;
  return jsonb_build_object('state', 'job', 'job', jsonb_build_object('id', j.id, 'merchantId', j.merchant_id, 'dateType', j.date_type,
    'from', j.date_from, 'to', j.date_to, 'attempts', j.attempts));
end $$;

-- 人工重抓佔呼叫額度（跟排程同一個時間戳）。開關、停機不擋：人工補跑本來就是排程停下來時用的
create or replace function public.payout_reserve_call(p_min_interval_seconds integer default 61) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings;
begin
  select * into s from public.payout_settings where id for update;
  if s.ecpay_last_call_at > now() - make_interval(secs => p_min_interval_seconds) then
    return jsonb_build_object('ok', false, 'retryAfterSeconds', ceil(extract(epoch from s.ecpay_last_call_at + make_interval(secs => p_min_interval_seconds) - now()))::integer);
  end if;
  update public.payout_settings set ecpay_last_call_at = now(), updated_at = now() where id;
  return jsonb_build_object('ok', true);
end $$;

-- 寫回工作結果（重試規則在 payoutRunner.ts 的 jobFinish）。halt 有值＝全部停（ECPAY_DENIED）
create or replace function public.payout_job_finish(p_job uuid, p_finish jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payout_jobs set status = p_finish->>'status', attempts = (p_finish->>'attempts')::integer,
         next_attempt_at = coalesce((p_finish->>'nextAttemptAt')::timestamptz, next_attempt_at), lease_until = null,
         last_import_id = coalesce((p_finish->>'importId')::uuid, last_import_id), updated_at = now()
   where id = p_job;
  if not found then raise exception 'payout job not found: %', p_job; end if;
  if jsonb_typeof(p_finish->'halt') = 'object' then
    update public.payout_settings set halted_at = now(), halt_code = p_finish->'halt'->>'code', halt_message = left(p_finish->'halt'->>'message', 200), updated_at = now() where id;
  end if;
end $$;

-- 要對帳的特約商店：現在可收款的，以及 60 天內還有已請款授權的（停用後繼續對帳，涵蓋退刷扣回，A-10）
create or replace function public._payout_merchants() returns table (merchant_id text)
language sql stable set search_path = public as $$
  select m.ecpay_merchant_id from public.seller_ecpay_merchants m where m.status = 'active'
  union
  select distinct a.merchant_id from public.payment_auths a where a.state = 'captured' and a.created_at > now() - interval '60 days';
$$;

-- 每天 15:10（台灣）排入當天的工作：每家店一件，依結算日查今天往前 14 天到今天（D41＝A）。
-- 開關關著時什麼都不做（AC-R19：不呼叫綠界、不寫匯入紀錄）。同一天重複呼叫不會多排。
create or replace function public.payout_enqueue_daily(p_today date default (now() at time zone 'Asia/Taipei')::date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not (select reconcile_enabled from public.payout_settings where id) then return jsonb_build_object('state', 'disabled', 'enqueued', 0); end if;
  insert into public.payout_jobs (merchant_id, run_date, kind, date_type, date_from, date_to)
  select m.merchant_id, p_today, 'daily', 'settle', p_today - 14, p_today from public._payout_merchants() m
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('state', 'ok', 'enqueued', v_n);
end $$;

-- 回補（上線第一天、或排程停過一段時間）：p_segments＝已拆好、每段 ≤ 1 個月的範圍（payoutDates.splitRange），每家店每段一件。
-- 指定 p_merchant 時只排那一家（不在要對帳的清單裡也可以，例如停用很久的店）。
create or replace function public.payout_enqueue_backfill(p_segments jsonb, p_merchant text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.payout_jobs (merchant_id, run_date, kind, date_type, date_from, date_to)
  select m.merchant_id, (now() at time zone 'Asia/Taipei')::date, 'backfill', 'settle', (s->>'from')::date, (s->>'to')::date
    from (select x.merchant_id from public._payout_merchants() x where p_merchant is null union select p_merchant where p_merchant is not null) m,
         jsonb_array_elements(p_segments) s
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('state', 'ok', 'enqueued', v_n);
end $$;

-- 維運：綠界 ECPAY_DENIED 的原因排除後恢復排程；異常標成已處理
create or replace function public.payout_ops_resume() returns jsonb
language sql security definer set search_path = public as $$
  update public.payout_settings set halted_at = null, halt_code = null, halt_message = null, updated_at = now() where id
  returning jsonb_build_object('resumed', true);
$$;
create or replace function public.payout_ops_resolve_anomaly(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception '請寫處理備註' using hint = 'NOTE_REQUIRED'; end if;
  update public.payout_anomalies set status = 'resolved', resolution_note = left(p_note, 500), resolved_at = now() where id = p_id and status = 'open';
  if not found then raise exception '找不到這筆未處理的異常' using hint = 'ANOMALY_NOT_FOUND'; end if;
  return jsonb_build_object('resolved', p_id);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 撥款狀態推算（§6.1；依序判斷，先中先贏；「今天」一律台灣時間）
-- ═══════════════════════════════════════════════════════════════════════
-- clawed_back：有任何對上的退刷列（交易金額負數），或正數列的退款金額欄 > 0（A-4 的另一種格式；實測檔是前者）
-- paid_out：有對上的正數列，撥款日 ≤ 今天   scheduled：撥款日 > 今天（綠界測試環境實測未來撥款日是空的，正式環境待 A-2 確認）
-- captured：其他情況下，這家店最近一次成功匯入在 36 小時內、而且付款後未滿 10 天   updating：其他所有情況（含對帳開關關著）
create or replace function public._payout_view(p_order uuid, p_now timestamptz)
returns table (order_id uuid, payout_status text, expected_payout_date date, paid_out_date date, payout_amount integer, fee_amount integer,
               clawback_amount integer, clawback_date date, data_updated_at timestamptz, has_ledger_rows boolean)
language plpgsql stable set search_path = public as $$
declare
  v_today   date := (p_now at time zone 'Asia/Taipei')::date;
  v_merch   text;
  v_paid_at timestamptz;
  v_last    timestamptz;
  ch        public.payout_ledger;
  v_claw    integer;
  v_cdate   date;
begin
  order_id := p_order; payout_status := 'updating'; expected_payout_date := null; paid_out_date := null; payout_amount := null; fee_amount := null;
  clawback_amount := null; clawback_date := null; data_updated_at := null; has_ledger_rows := false;
  if not coalesce((select s.reconcile_enabled from public.payout_settings s where s.id), false) then return next; return; end if;

  select a.merchant_id, o.paid_at into v_merch, v_paid_at
    from public.orders o left join public.payment_auths a on a.order_id = o.id and a.state = 'captured'
   where o.id = p_order order by a.updated_at desc nulls last limit 1;
  has_ledger_rows := exists (select 1 from public.payout_ledger l where l.order_id = p_order);
  select max(i.finished_at) into v_last from public.payout_imports i
   where i.merchant_id = coalesce((select l.merchant_id from public.payout_ledger l where l.order_id = p_order limit 1), v_merch)
     and i.result in ('ok', 'empty') and i.finished_at <= p_now;
  select * into ch from public.payout_ledger l where l.order_id = p_order and l.kind = 'charge' order by l.created_at limit 1;
  if ch.id is not null then payout_amount := ch.net_amount; end if;

  select coalesce(sum(case when l.kind = 'refund' then -l.amount else coalesce(l.refund_amount, 0) end), 0), max(l.payout_date)
    into v_claw, v_cdate
    from public.payout_ledger l where l.order_id = p_order and (l.kind = 'refund' or coalesce(l.refund_amount, 0) > 0);

  if v_claw > 0 then
    payout_status := 'clawed_back'; clawback_amount := v_claw; clawback_date := v_cdate;
  elsif ch.id is not null and ch.payout_date is not null then
    if ch.payout_date <= v_today then payout_status := 'paid_out'; paid_out_date := ch.payout_date;
    else payout_status := 'scheduled'; expected_payout_date := ch.payout_date; end if;
  elsif v_last > p_now - interval '36 hours' and v_paid_at > p_now - interval '10 days' then
    payout_status := 'captured';
  end if;
  if payout_status <> 'updating' then data_updated_at := v_last; end if;
  return next;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 前端 RPC：賣家訂單頁一次取多張訂單的撥款狀態（§10.1；AC-R24 一次請求）
-- ═══════════════════════════════════════════════════════════════════════
-- 只回呼叫者自己店的、payment='ecpay_card' 且付過款（paid／refunding／refunded：退款後要看得到扣回）的訂單；其他 id 直接略過（不報錯）。
-- 匿名或沒開店回空陣列。不回：特約商店編號、交易編號、手續費明細、平台手續費（D42＝C；fee_amount 一律 null）。
create or replace function public.get_seller_order_payouts(p_order_ids uuid[])
returns table (order_id uuid, payout_status text, expected_payout_date date, paid_out_date date, payout_amount integer, fee_amount integer,
               clawback_amount integer, clawback_date date, data_updated_at timestamptz, has_ledger_rows boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if coalesce(cardinality(p_order_ids), 0) > 200 then perform public._rv_raise('TOO_MANY_IDS', '一次最多查 200 張訂單'); end if;
  return query
    select v.* from public.orders o
      join public.shops s on s.id = o.shop_id and s.owner_id = v_uid
      cross join lateral public._payout_view(o.id, now()) v
     where o.id = any (p_order_ids) and o.payment = 'ecpay_card' and o.payment_status in ('paid', 'refunding', 'refunded')
     order by o.created_at desc, o.id;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. 權限
-- ═══════════════════════════════════════════════════════════════════════
revoke all on function public.get_seller_order_payouts(uuid[]) from public;
grant execute on function public.get_seller_order_payouts(uuid[]) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['payout_tick_claim(integer,integer)', 'payout_reserve_call(integer)', 'payout_import_begin(text,text,text,date,date,uuid)',
                           'payout_ingest(uuid,jsonb)', 'payout_classify(text,jsonb)', 'payout_import_finish(uuid,jsonb)', 'payout_job_finish(uuid,jsonb)',
                           'payout_enqueue_daily(date)', 'payout_enqueue_backfill(jsonb,text)', 'payout_ops_resume()', 'payout_ops_resolve_anomaly(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['_payout_is_ours(text)', '_payout_classify_rows(text,jsonb)', '_payout_counts(text[])', '_payout_row_data(jsonb)', '_payout_mask(jsonb)', '_payout_row_problem(jsonb)',
                           '_payout_merchants()', '_payout_view(uuid,timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. 自我檢查：權限不如預期就整個回滾（AC-R11）
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r text; t text; p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['payout_settings', 'payout_jobs', 'payout_imports', 'payout_ledger', 'payout_anomalies'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) then
          raise exception '撥款對帳自我檢查失敗：% 對 % 有 % 權限，整個交易回滾', r, t, p;
        end if;
      end loop;
    end loop;
    foreach t in array array['payout_tick_claim(integer,integer)', 'payout_reserve_call(integer)', 'payout_import_begin(text,text,text,date,date,uuid)',
                             'payout_ingest(uuid,jsonb)', 'payout_classify(text,jsonb)', 'payout_import_finish(uuid,jsonb)', 'payout_job_finish(uuid,jsonb)',
                             'payout_enqueue_daily(date)', 'payout_enqueue_backfill(jsonb,text)', 'payout_ops_resume()', 'payout_ops_resolve_anomaly(uuid,text)',
                             '_payout_classify_rows(text,jsonb)', '_payout_view(uuid,timestamptz)', '_payout_merchants()', '_payout_row_data(jsonb)'] loop
      if has_function_privilege(r, 'public.' || t, 'execute') then
        raise exception '撥款對帳自我檢查失敗：% 可以執行 %，整個交易回滾', r, t;
      end if;
    end loop;
    if not has_function_privilege(r, 'public.get_seller_order_payouts(uuid[])', 'execute') then
      raise exception '撥款對帳自我檢查失敗：% 不能執行 get_seller_order_payouts，整個交易回滾', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.payout_ingest(uuid,jsonb)', 'execute') then
    raise exception '撥款對帳自我檢查失敗：service_role 不能執行 payout_ingest，整個交易回滾';
  end if;
  foreach t in array array['get_seller_order_payouts', 'payout_tick_claim', 'payout_ingest', 'payout_classify', 'payout_enqueue_daily', 'payout_enqueue_backfill'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = t) <> 1 then
      raise exception '撥款對帳自我檢查失敗：% 有多載（PostgREST 會 PGRST203），整個交易回滾', t;
    end if;
  end loop;
  -- RPC 回傳欄位不含平台手續費、交易編號、特約商店編號（D42＝C、AC-R11）
  if exists (select 1 from pg_proc pr, unnest(pr.proargnames) a where pr.proname = 'get_seller_order_payouts' and pr.pronamespace = 'public'::regnamespace
               and a in ('platform_fee', 'merchant_id', 'merchant_trade_no', 'ecpay_trade_no', 'gateway_fee')) then
    raise exception '撥款對帳自我檢查失敗：get_seller_order_payouts 回傳了不該給賣家的欄位，整個交易回滾';
  end if;
  -- 不新增任何指向 auth.users 的外鍵（刪帳號工具 KNOWN_FK 的 with_payment 組維持 10 個）
  if exists (select 1 from pg_constraint c where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
               and c.conrelid in ('public.payout_settings'::regclass, 'public.payout_jobs'::regclass, 'public.payout_imports'::regclass,
                                  'public.payout_ledger'::regclass, 'public.payout_anomalies'::regclass)) then
    raise exception '撥款對帳自我檢查失敗：新表有指向 auth.users 的外鍵，整個交易回滾';
  end if;
  -- 卡號不落地：任何新表都沒有卡號、發卡銀行欄（AC-R4）
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'payout\_%' and column_name ~ '(card|bank)') then
    raise exception '撥款對帳自我檢查失敗：新表有卡號或發卡銀行欄，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
