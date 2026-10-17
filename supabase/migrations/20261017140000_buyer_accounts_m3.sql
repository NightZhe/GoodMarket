-- 買家註冊登入 M3：移除訂單憑證（.work/buyer-auth/spec.md v0.2 第 9.3、13 節；decisions.md D16）
--
-- 不可逆：orders.access_token 欄位被刪掉之後，憑證路徑無法回復（M2 的回滾就沒有意義了）。
-- 所以 M3 要等「新前端穩定」「M2 已套」「舊訪客訂單已刪除並驗證」之後才套。
--
-- 做什麼：
--   1. 防呆：資料庫裡還有「訪客訂單」（buyer_id is null and buyer_deleted_at is null）就整個中止，什麼都不改。
--      理由：這些訂單的買家只能靠 access_token 查單／取消／評價；欄位一刪，它們就成了沒有人能動的孤兒，
--      而且刪除工具（.work/buyer-auth/tools/）的「訂單數是否符合預期」防呆也失去意義。
--      先依 prod-runbook.md 第 4 節刪除舊訪客訂單，再套 M3。
--      注意：「帳號已刪除的訂單」（人工刪帳號後 buyer_id 變 null，但 buyer_deleted_at 有值）不是訪客訂單，
--      是要保留給賣家對帳的交易紀錄，不會觸發這個防呆，也絕對不要用刪除舊訂單的工具去刪它們。
--   2. drop 舊的 place_order 與 6 支憑證 RPC，以及 _rv_load_order(uuid, text)。
--      新前端用 place_account_order 與帳號版 RPC，不依賴這些。
--   3. drop 欄位 orders.access_token（欄位權限、預設值跟著欄位一起消失；沒有 view、policy、trigger 依賴它，
--      如果有，這裡的 alter table 會報錯而整個交易回滾——刻意不加 cascade）。
--   4. 自我檢查：public 裡不剩任何函式內文提到 access_token 或 _rv_load_order。
--
-- 不用動：_place_order_core（回傳 setof orders，不引用欄位名稱）、buyer_order 型別（本來就沒有 token）、
--   前端 SHOP_ORDER_FIELDS（15 欄本來就不含 access_token）、orders_track_event／orders_guard_status 兩個 trigger。
-- 可重複執行。整個檔案包在一個交易裡：任何一步失敗就整個回滾。

begin;

-- 1. 防呆：還有訪客訂單 → 中止
do $$
declare
  n integer;
begin
  select count(*) into n from public.orders where buyer_id is null and buyer_deleted_at is null;
  if n > 0 then
    raise exception 'M3 中止：資料庫裡還有 % 筆訪客訂單（沒有買家帳號、也不是帳號被刪除造成的）。這是上線前舊版遊客下的訂單，要先依 prod-runbook.md 第 4 節預覽、刪除並驗證，再套用 M3。如果筆數和預期不同，請停下來回報，不要自行刪除任何訂單。沒有改動任何東西。', n
      using hint = 'GUEST_ORDERS_REMAIN';
  end if;
end $$;

-- 2. drop 函式（先 drop 外層的 RPC，最後 drop 它們共用的 _rv_load_order）
drop function if exists public.place_order(jsonb, jsonb, text);
drop function if exists public.get_my_orders(jsonb);
drop function if exists public.cancel_my_order(uuid, text);
drop function if exists public.complete_my_order(uuid, text);
drop function if exists public.get_my_review_status(jsonb);
drop function if exists public.request_review_upload(uuid, text, uuid, integer);
drop function if exists public.submit_reviews(uuid, text, text, jsonb);
drop function if exists public._rv_load_order(uuid, text);

-- 3. drop 欄位
alter table public.orders drop column if exists access_token;

-- 4. 自我檢查
do $$
declare
  leftover text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into leftover
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (pg_get_functiondef(p.oid) ilike '%access_token%' or pg_get_functiondef(p.oid) ilike '%_rv_load_order(%');
  if leftover is not null then
    raise exception 'M3 自我檢查失敗：這些函式還引用 access_token 或 _rv_load_order：%，整個交易回滾', leftover;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'orders' and column_name = 'access_token') then
    raise exception 'M3 自我檢查失敗：orders.access_token 還在，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
