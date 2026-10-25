-- 檢舉通知機制（.work/store-prereqs/spec.md §7.2 R-K7～R-K10、§9 N17、工單 B-4）
--
-- 做法：reports 的 AFTER INSERT 觸發器 → pg_net 非同步 POST { id } 到 Edge Function report-notify → 該函式寄信給站方信箱、
--       把結果寫回 reports.notified_at／notify_attempts／notify_error（Edge Function 的部分見 supabase/functions/report-notify/）。
--
-- 只做相容的新增：一張設定表、一個觸發器函式、一個觸發器。不動任何既有的表、欄位、權限、函式，也不動 reports 本身。
-- 只依賴 20261025121000_content_reports.sql 的 public.reports。
--
-- 【寄信是盡力而為（R-K7）】觸發器對下列情況一律「安靜略過」，submit_report 照常成功、回應一樣：
--   · pg_net 沒有啟用（net.http_post 不存在）——正式站目前就是這個狀態；本檔「不」create extension，由使用者在後台啟用
--   · 設定表是空的（還沒填 function_url／shared_secret）
--   · 呼叫 net.http_post 時出任何錯（包在 begin … exception when others）
-- pg_net 本身是「交易提交後才送出請求」，所以檢舉寫入若回滾就不會寄；送出之後 Edge Function 掛了、SMTP 失敗，都不影響已提交的檢舉。
-- 錯誤只留在資料庫日誌（raise log，不是 warning，所以不會傳給呼叫端），不寫進 reports。
--
-- 設定表 report_notify_config：只有一列（singleton），內容是 Edge Function 的網址與共用密鑰。
--   對 anon、authenticated、service_role 零權限，RLS 開著不建 policy；只有觸發器函式（SECURITY DEFINER）與 postgres 讀得到。
--   寫入方式見 .work/store-prereqs/runbook-report-notify.md（用後台 SQL Editor，以 postgres 身分執行）。
--   共用密鑰必須與 Edge Function 的 secret REPORT_NOTIFY_SECRET 相同。
-- 可重複執行。

create table if not exists public.report_notify_config (
  singleton     boolean primary key default true,
  function_url  text not null,
  shared_secret text not null,
  updated_at    timestamptz not null default now(),
  constraint report_notify_config_singleton check (singleton),
  constraint report_notify_config_url_valid check (function_url ~ '^https?://[^\s]+$'),
  constraint report_notify_config_secret_valid check (char_length(shared_secret) >= 16)
);
alter table public.report_notify_config enable row level security;
revoke all on public.report_notify_config from public, anon, authenticated, service_role;

-- 觸發器函式：絕不讓 insert 失敗。
create or replace function public._rpt_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    -- pg_net 沒啟用 → 不做事（用 pg_proc 查，不直接呼叫，才不會在沒有 net schema 時報錯）
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'net' and p.proname = 'http_post') then
      return null;
    end if;
    select c.function_url, c.shared_secret into v_url, v_secret from public.report_notify_config c limit 1;
    if v_url is null or v_secret is null then
      return null;   -- 還沒設定 → 只寫表
    end if;
    perform net.http_post(
      url                  := v_url,
      body                 := jsonb_build_object('id', new.id),
      headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 30000
    );
  exception when others then
    -- 吞掉所有錯誤；只留在資料庫日誌（不含密鑰：sqlerrm 不會帶 header 內容）
    raise log 'report_notify: skipped for report % (%: %)', new.id, sqlstate, sqlerrm;
  end;
  return null;   -- AFTER 觸發器的回傳值被忽略
end $$;
revoke all on function public._rpt_notify() from public, anon, authenticated;

drop trigger if exists reports_notify on public.reports;
create trigger reports_notify after insert on public.reports
  for each row execute function public._rpt_notify();
