-- 檢舉（商品／評價／店家）（.work/store-prereqs/spec.md §7、§10.3、§12；工單 B-2；決策 N6、N7、N10）
--
-- 只做相容的新增：一張新表 reports、一個前端 RPC submit_report、一個 _rpt_* 內部函式。
-- 不動任何既有的表、欄位、權限、函式；舊前端不讀這些，所以先套資料庫、再推前端都安全。
-- 只依賴 20261016120000（_rv_raise、_rv_trim、product_reviews）與 20261017120000（_acct_uid）與基準檔的 products／shops；
-- 不依賴 20261019200000～20261020140000（金流）任何一支，所以也能套在「尚未套金流的正式站」。
--
-- 設計重點：
--   · 表不建任何外鍵（N7）：檢舉人、目標、所屬店都只存 uuid ＋ 當時的快照名稱。
--     所以目標被刪、檢舉人帳號被刪，檢舉紀錄都還在；手機版刪帳號工具／刪店工具的外鍵防呆清單完全不用改。
--     reporter_id 可為 null：帳號被刪時由站方工具清空（N6，B-3），內容保留。
--   · 權限：對 anon、authenticated 零權限（連 select 都沒有），RLS 開著且不建 policy。
--     寫入只有 submit_report 與 service role（站方 SQL、通知機制）。
--   · 競爭：同一帳號的 submit_report 用 advisory lock 排隊 —— 「同一人同一目標 open 最多 1 筆」
--     （部分唯一索引是第二道鎖）與「每台北日最多 20 筆新檢舉」（N10）在同時送出時都成立。
--   · 重複（R-K3）：同一人對同一目標已有 open 的檢舉 → 不新增、回 duplicate:true（不計入每日上限）。
--     被站方結案（resolved／dismissed）後再檢舉 → 新的一筆。
--   · 說明（R-K5）：去前後空白、CRLF／CR 轉 LF、空字串視為沒填（存 null）、不得含 \n 以外的控制字元、
--     ≤ 200 個 code point。原因 other 時說明仍是選填。
--   · 快照（R-K6）：商品名／店名／評價前 50 字，與目標所屬店 id；已下架商品、被隱藏的評價也可以檢舉（R-K2）。
--
-- 【通知（R-K7～R-K10）不在本檔】寄信機制由 B-4 另加一支 migration（觸發器或排程，擇一）。
--   本檔只在表上預留通知欄位：notified_at（已通知時間）、notify_attempts（嘗試次數，預設 0）、
--   notify_error（最後一次錯誤摘要，不含信件內容）。本檔沒有在 reports 上建任何觸發器，
--   所以沒有通知機制時 submit_report 照常成功（AC-K9 (a)）；B-4 的觸發器必須吞掉所有錯誤（R-K7）。
--   「未通知」的檢舉＝ notified_at is null（reports_unnotified_idx 支援這個查詢，IN-14 用）。
--
-- 錯誤格式沿用既有慣例：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）。
-- 帳號版 RPC 開給 anon（慣例同 buyer_accounts_m1）：session 過期時得到中文的 NOT_AUTHENTICATED。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 資料表
-- ═══════════════════════════════════════════════════════════════════════
-- 目標類型與原因存代碼（不存畫面字樣）：
--   target_type：product／review／shop
--   reason：prohibited（違禁或違法）／counterfeit（仿冒侵權）／scam（詐騙不實）／offensive（色情暴力）／harassment（騷擾仇恨個資）／other
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid,                                    -- 檢舉人帳號識別碼；刻意不是外鍵（N7），帳號刪除後由工具清成 null（N6）
  target_type     text not null,
  target_id       uuid not null,                           -- 刻意不是外鍵
  target_label    text not null,                           -- 目標快照名稱（商品名／店名／評價前 50 字）
  target_shop_id  uuid not null,                           -- 目標所屬店的 id（快照；刻意不是外鍵）
  reason          text not null,
  details         text,                                    -- 檢舉人的說明；沒填＝null
  created_at      timestamptz not null default now(),
  status          text not null default 'open',            -- open（未處理）／resolved（已處理）／dismissed（不成立）
  resolved_at     timestamptz,
  resolution_note text,                                    -- 站方內部備註，不給前端
  notified_at     timestamptz,                             -- 通知（寄信）成功時間；B-4 寫入
  notify_attempts integer not null default 0,              -- 通知嘗試次數；B-4 寫入
  notify_error    text,                                    -- 最後一次通知錯誤摘要（不含信件內容）；B-4 寫入
  constraint reports_target_type_valid  check (target_type in ('product', 'review', 'shop')),
  constraint reports_reason_valid       check (reason in ('prohibited', 'counterfeit', 'scam', 'offensive', 'harassment', 'other')),
  constraint reports_status_valid       check (status in ('open', 'resolved', 'dismissed')),
  -- 處理狀態與處理時間成對：open 沒有處理時間；resolved／dismissed 一定有
  constraint reports_resolved_pair      check ((status = 'open' and resolved_at is null) or (status in ('resolved', 'dismissed') and resolved_at is not null)),
  -- 說明 1..200 個 code point（char_length），不得只有空白，不得含 \n 以外的控制字元（沒填一律存 null）
  constraint reports_details_valid      check (details is null or (char_length(details) between 1 and 200
                                               and details !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]'
                                               and details ~ '[^\s 　]')),
  constraint reports_label_valid        check (char_length(target_label) between 1 and 100),
  constraint reports_note_valid         check (resolution_note is null or char_length(resolution_note) <= 1000),
  constraint reports_notify_valid       check (notify_attempts >= 0 and (notify_error is null or char_length(notify_error) <= 500))
);
-- 同一檢舉人＋同一目標 open 最多 1 筆（R-K3；競爭下也成立）。reporter_id 為 null 的列不受限（帳號已刪）。
create unique index if not exists reports_one_open_per_reporter_target on public.reports (reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;
-- 每日上限（N10）：某帳號今天送了幾筆
create index if not exists reports_reporter_day on public.reports (reporter_id, created_at desc) where reporter_id is not null;
-- 站方處理：未處理清單、某目標的所有檢舉、未通知清單
create index if not exists reports_open_idx       on public.reports (created_at desc) where status = 'open';
create index if not exists reports_target_idx     on public.reports (target_type, target_id);
create index if not exists reports_unnotified_idx on public.reports (created_at) where notified_at is null;

alter table public.reports enable row level security;
revoke all on public.reports from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 內部小工具
-- ═══════════════════════════════════════════════════════════════════════
-- 說明欄位的清理與驗證（R-K5）：回清理後的值；沒填回 null。
create or replace function public._rpt_clean_details(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := public._rv_trim(replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'));
begin
  if v = '' then return null; end if;
  if v ~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]' then
    perform public._rv_raise('REPORT_DETAILS_INVALID', '說明含有不能使用的字元');
  end if;
  if char_length(v) > 200 then
    perform public._rv_raise('REPORT_DETAILS_TOO_LONG', '說明最多 200 字');
  end if;
  return v;
end $$;
revoke all on function public._rpt_clean_details(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RPC（§10.3）
-- ═══════════════════════════════════════════════════════════════════════
-- 送出檢舉。回 { id, duplicate }。
--   檢查順序：登入 → 目標類型 → 原因 → 說明 → 目標存在 → （鎖）重複 → 每日上限 → 寫入。
--   · 重複＝同一人對同一目標已有 open 的檢舉：回既有那筆的 id、duplicate:true，不改內容、不計入上限。
--   · 每日上限＝這個帳號在「今天（台北日）」已寫入的新檢舉（不論後來是否結案）≥ 20 → REPORT_DAILY_LIMIT。
create or replace function public.submit_report(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := public._acct_uid('請先登入');
  v_details text;
  v_label   text;
  v_shop    uuid;
  v_id      uuid;
  v_day     timestamptz := (date_trunc('day', now() at time zone 'Asia/Taipei')) at time zone 'Asia/Taipei';
begin
  if p_target_type is null or p_target_type not in ('product', 'review', 'shop') or p_target_id is null then
    perform public._rv_raise('REPORT_TARGET_INVALID', '檢舉對象不正確');
  end if;
  if p_reason is null or p_reason not in ('prohibited', 'counterfeit', 'scam', 'offensive', 'harassment', 'other') then
    perform public._rv_raise('REPORT_REASON_INVALID', '請選擇檢舉原因');
  end if;
  v_details := public._rpt_clean_details(p_details);

  -- 目標快照（下架商品、被隱藏的評價也可以檢舉）
  if p_target_type = 'product' then
    select p.title, p.shop_id into v_label, v_shop from public.products p where p.id = p_target_id;
  elsif p_target_type = 'shop' then
    select s.name, s.id into v_label, v_shop from public.shops s where s.id = p_target_id;
  else
    select coalesce(nullif(left(regexp_replace(public._rv_trim(r.content), '[\r\n\t]+', ' ', 'g'), 50), ''), '（只有星等，沒有文字）'), r.shop_id
      into v_label, v_shop from public.product_reviews r where r.id = p_target_id;
  end if;
  if v_shop is null then
    perform public._rv_raise('REPORT_TARGET_NOT_FOUND', '找不到要檢舉的內容，可能已被刪除');
  end if;
  v_label := left(v_label, 100);

  -- 同一帳號的檢舉排隊（上限與重複判斷在鎖內做，競爭下才成立）
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  select r.id into v_id from public.reports r
   where r.reporter_id = v_uid and r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  if (select count(*) from public.reports r
       where r.reporter_id = v_uid and r.created_at >= v_day and r.created_at < v_day + interval '1 day') >= 20 then
    perform public._rv_raise('REPORT_DAILY_LIMIT', '今天的檢舉次數已達上限，請明天再試');
  end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, target_label, target_shop_id, reason, details)
    values (v_uid, p_target_type, p_target_id, v_label, v_shop, p_reason, v_details)
    returning id into v_id;
  exception when unique_violation then   -- 理論上被鎖擋掉；萬一（例如站方 SQL 同時寫入）也當成重複
    select r.id into v_id from public.reports r
     where r.reporter_id = v_uid and r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open';
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 函式權限
-- ═══════════════════════════════════════════════════════════════════════
revoke all on function public.submit_report(text, uuid, text, text) from public;
grant execute on function public.submit_report(text, uuid, text, text) to anon, authenticated;
